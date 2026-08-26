import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "./identity.js";
import type { Comparison, EvidenceSource, PlanFacts, Scenario, Synthesis } from "./contracts.js";
import { AppError } from "./errors.js";
import { scoreSeverity } from "./scoring.js";
import { transaction } from "./db.js";

export type AnalysisRun = {
  id: string;
  projectId: string;
  organizationId: string;
  requestedBy: string;
  plan: string;
  status: "queued" | "running" | "succeeded" | "failed";
  policyVersion: string;
};

export type StoredRisk = {
  id: string;
  category: string;
  title: string;
  explanation: string;
  evidenceIds: string[];
  impact: number;
  likelihood: number;
  severity: number;
  mitigation: string;
  uncertainty: string;
};

export class Repository {
  constructor(private readonly pool: Pool) {}

  async assertProjectMember(projectId: string, actor: Actor) {
    const result = await this.pool.query(
      `SELECT 1
       FROM projects p
       JOIN memberships m ON m.organization_id = p.organization_id
       WHERE p.id = $1 AND p.organization_id = $2 AND m.user_id = $3
       LIMIT 1`,
      [projectId, actor.org_id, actor.sub],
    );
    if (!result.rowCount) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  async createOrReuseRun(input: { projectId: string; plan: string; idempotencyKey: string; actor: Actor; policyVersion: string }) {
    const id = randomUUID();
    const result = await this.pool.query<Pick<AnalysisRun, "id" | "status">>(
      `INSERT INTO analysis_runs (id, project_id, organization_id, requested_by, plan, status, idempotency_key, policy_version)
       VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
       ON CONFLICT (organization_id, idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING id, status`,
      [id, input.projectId, input.actor.org_id, input.actor.sub, input.plan, input.idempotencyKey, input.policyVersion],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(500, "RUN_CREATE_FAILED", "Unable to create analysis run", false);
    return row;
  }

  async getRunForWorker(runId: string): Promise<AnalysisRun | null> {
    const result = await this.pool.query<AnalysisRun>(
      `UPDATE analysis_runs SET status = 'running', started_at = NOW()
       WHERE id = $1 AND status IN ('queued', 'failed')
       RETURNING id, project_id AS "projectId", organization_id AS "organizationId", requested_by AS "requestedBy", plan, status, policy_version AS "policyVersion"`,
      [runId],
    );
    return result.rows[0] ?? null;
  }

  async saveEvidence(runId: string, evidence: EvidenceSource[]) {
    await transaction(this.pool, async (client) => {
      for (const source of evidence) {
        await client.query(
          `INSERT INTO evidence_sources (id, analysis_run_id, branch, url, hostname, title, publisher, snippet, provider_rank, source_tier, status, rejection_reason, retrieved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [source.id, runId, source.branch, source.url, source.hostname, source.title, source.publisher, source.snippet, source.providerRank, source.sourceTier, source.status, source.rejectionReason ?? null, source.retrievedAt],
        );
      }
    });
  }

  async clearTransientArtifacts(runId: string) {
    await transaction(this.pool, async (client) => {
      await client.query(`DELETE FROM disagreement_records WHERE analysis_run_id = $1`, [runId]);
      await client.query(`DELETE FROM branch_runs WHERE analysis_run_id = $1`, [runId]);
      await client.query(`DELETE FROM evidence_sources WHERE analysis_run_id = $1`, [runId]);
    });
  }

  async completeRun(args: { runId: string; facts: PlanFacts; scenarioA: Scenario; scenarioB: Scenario; comparison: Comparison; synthesis: Synthesis }) {
    await transaction(this.pool, async (client) => {
      await this.saveBranch(client, args.runId, "A", args.scenarioA);
      await this.saveBranch(client, args.runId, "B", args.scenarioB);
      await client.query(
        `INSERT INTO disagreement_records (id, analysis_run_id, category_relation, claim_relation, evidence_overlap, display_status, explanation)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), args.runId, args.comparison.categoryRelation, args.comparison.semanticRelation, args.comparison.evidenceOverlap, args.comparison.displayStatus, args.comparison.explanation],
      );
      for (const risk of args.synthesis.risks) {
        const riskId = randomUUID();
        const severity = scoreSeverity(risk.impact, risk.likelihood);
        await client.query(
          `INSERT INTO risk_items (id, analysis_run_id, category, title, explanation, impact, likelihood, severity, mitigation, uncertainty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [riskId, args.runId, risk.category, risk.title, risk.explanation, risk.impact, risk.likelihood, severity, risk.mitigation, risk.uncertainty],
        );
        for (const evidenceId of risk.evidenceIds) {
          await client.query(
            `INSERT INTO risk_evidence (risk_item_id, evidence_source_id, relation) VALUES ($1,$2,'supports')`,
            [riskId, evidenceId],
          );
        }
      }
      await client.query(
        `UPDATE analysis_runs SET status = 'succeeded', completed_at = NOW(), normalized_plan = $2::jsonb WHERE id = $1`,
        [args.runId, JSON.stringify(args.facts)],
      );
    });
  }

  private async saveBranch(client: PoolClient, runId: string, branch: "A" | "B", scenario: Scenario) {
    await client.query(
      `INSERT INTO branch_runs (id, analysis_run_id, branch, primary_category, root_cause, scenario_json, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'succeeded')`,
      [randomUUID(), runId, branch, scenario.primaryCategory, scenario.rootCause, JSON.stringify(scenario)],
    );
  }

  async failRun(runId: string, reason: string) {
    await this.pool.query(
      `UPDATE analysis_runs SET status = 'failed', completed_at = NOW(), failure_code = $2 WHERE id = $1 AND status IN ('queued','running')`,
      [runId, reason.slice(0, 80)],
    );
  }

  async getAnalysis(runId: string, actor: Actor) {
    const run = await this.pool.query(
      `SELECT id, status, created_at AS "createdAt", completed_at AS "completedAt", normalized_plan AS "normalizedPlan", failure_code AS "failureCode"
       FROM analysis_runs WHERE id = $1 AND organization_id = $2`,
      [runId, actor.org_id],
    );
    if (!run.rowCount) throw new AppError(404, "ANALYSIS_NOT_FOUND", "Analysis not found");
    const [sources, branches, risks, disagreement] = await Promise.all([
      this.pool.query(`SELECT id, branch, url, hostname, title, publisher, snippet, provider_rank AS "providerRank", source_tier AS "sourceTier", status, retrieved_at AS "retrievedAt" FROM evidence_sources WHERE analysis_run_id = $1 AND status = 'retrieved' ORDER BY branch, provider_rank DESC NULLS LAST`, [runId]),
      this.pool.query(`SELECT branch, primary_category AS "primaryCategory", root_cause AS "rootCause", scenario_json AS scenario FROM branch_runs WHERE analysis_run_id = $1 ORDER BY branch`, [runId]),
      this.pool.query(`SELECT r.id, r.category, r.title, r.explanation, r.impact, r.likelihood, r.severity, r.mitigation, r.uncertainty, COALESCE(array_agg(re.evidence_source_id) FILTER (WHERE re.evidence_source_id IS NOT NULL), '{}') AS "evidenceIds" FROM risk_items r LEFT JOIN risk_evidence re ON re.risk_item_id = r.id WHERE r.analysis_run_id = $1 GROUP BY r.id ORDER BY r.severity DESC, r.created_at`, [runId]),
      this.pool.query(`SELECT category_relation AS "categoryRelation", claim_relation AS "semanticRelation", evidence_overlap AS "evidenceOverlap", display_status AS "displayStatus", explanation FROM disagreement_records WHERE analysis_run_id = $1`, [runId]),
    ]);
    return { ...run.rows[0], sources: sources.rows, branches: branches.rows, risks: risks.rows, disagreement: disagreement.rows[0] ?? null };
  }

  async getRiskForActor(riskId: string, actor: Actor): Promise<StoredRisk> {
    const result = await this.pool.query<StoredRisk>(
      `SELECT r.id, r.category, r.title, r.explanation, r.impact, r.likelihood, r.severity, r.mitigation, r.uncertainty,
       COALESCE(array_agg(re.evidence_source_id) FILTER (WHERE re.evidence_source_id IS NOT NULL), '{}') AS "evidenceIds"
       FROM risk_items r
       JOIN analysis_runs a ON a.id = r.analysis_run_id
       LEFT JOIN risk_evidence re ON re.risk_item_id = r.id
       WHERE r.id = $1 AND a.organization_id = $2
       GROUP BY r.id`,
      [riskId, actor.org_id],
    );
    const risk = result.rows[0];
    if (!risk) throw new AppError(404, "RISK_NOT_FOUND", "Risk not found");
    return risk;
  }

  async saveMitigation(args: { riskId: string; actor: Actor; answer: string; evidence: string; rationale: string; gaps: string[]; before: number; after: number }) {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO mitigation_assessments (id, risk_item_id, created_by, answer, control_evidence, rationale, gaps, severity_before, severity_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [randomUUID(), args.riskId, args.actor.sub, args.answer, args.evidence, args.rationale, JSON.stringify(args.gaps), args.before, args.after],
      );
      await client.query(`UPDATE risk_items SET severity = $2, updated_at = NOW() WHERE id = $1`, [args.riskId, args.after]);
    });
  }
}

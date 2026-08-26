import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "./identity.js";
import type { Comparison, CriticFinding, EvidenceSource, InvestigationPlan, PlanFacts, Scenario, Synthesis } from "./contracts.js";
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
  analysisRunId: string;
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

type TraceStatus = "completed" | "attention" | "approved" | "verified" | "failed" | "replan";

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

  async saveInvestigationPlan(runId: string, plan: InvestigationPlan) {
    await this.pool.query(
      `INSERT INTO investigation_plans (analysis_run_id, plan_json) VALUES ($1,$2::jsonb)
       ON CONFLICT (analysis_run_id) DO UPDATE SET plan_json = EXCLUDED.plan_json`,
      [runId, JSON.stringify(plan)],
    );
  }

  async saveCritic(runId: string, finding: CriticFinding) {
    await this.pool.query(
      `INSERT INTO critic_records (analysis_run_id, finding, evidence_gaps, next_check) VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT (analysis_run_id) DO UPDATE SET finding = EXCLUDED.finding, evidence_gaps = EXCLUDED.evidence_gaps, next_check = EXCLUDED.next_check`,
      [runId, finding.finding, JSON.stringify(finding.evidenceGaps), finding.nextCheck],
    );
  }

  async recordTrace(args: { runId: string; skill: string; stage: string; status: TraceStatus; detail: string; metadata?: Record<string, unknown> }) {
    await this.pool.query(
      `INSERT INTO agent_trace_events (id, analysis_run_id, skill, stage, status, detail, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [randomUUID(), args.runId, args.skill, args.stage, args.status, args.detail.slice(0, 800), JSON.stringify(args.metadata ?? {})],
    );
  }

  async clearTransientArtifacts(runId: string) {
    await transaction(this.pool, async (client) => {
      await client.query(`DELETE FROM agent_trace_events WHERE analysis_run_id = $1`, [runId]);
      await client.query(`DELETE FROM critic_records WHERE analysis_run_id = $1`, [runId]);
      await client.query(`DELETE FROM investigation_plans WHERE analysis_run_id = $1`, [runId]);
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
    const [sources, branches, risks, disagreement, planner, critic, trace, actions] = await Promise.all([
      this.pool.query(`SELECT id, branch, url, hostname, title, publisher, snippet, provider_rank AS "providerRank", source_tier AS "sourceTier", status, retrieved_at AS "retrievedAt" FROM evidence_sources WHERE analysis_run_id = $1 AND status = 'retrieved' ORDER BY branch, provider_rank DESC NULLS LAST`, [runId]),
      this.pool.query(`SELECT branch, primary_category AS "primaryCategory", root_cause AS "rootCause", scenario_json AS scenario FROM branch_runs WHERE analysis_run_id = $1 ORDER BY branch`, [runId]),
      this.pool.query(`SELECT r.id, r.category, r.title, r.explanation, r.impact, r.likelihood, r.severity, r.mitigation, r.uncertainty, COALESCE(array_agg(re.evidence_source_id) FILTER (WHERE re.evidence_source_id IS NOT NULL), '{}') AS "evidenceIds" FROM risk_items r LEFT JOIN risk_evidence re ON re.risk_item_id = r.id WHERE r.analysis_run_id = $1 GROUP BY r.id ORDER BY r.severity DESC, r.created_at`, [runId]),
      this.pool.query(`SELECT category_relation AS "categoryRelation", claim_relation AS "semanticRelation", evidence_overlap AS "evidenceOverlap", display_status AS "displayStatus", explanation FROM disagreement_records WHERE analysis_run_id = $1`, [runId]),
      this.pool.query(`SELECT plan_json AS plan FROM investigation_plans WHERE analysis_run_id = $1`, [runId]),
      this.pool.query(`SELECT finding, evidence_gaps AS "evidenceGaps", next_check AS "nextCheck" FROM critic_records WHERE analysis_run_id = $1`, [runId]),
      this.pool.query(`SELECT skill, stage, status, detail, metadata, created_at AS "createdAt" FROM agent_trace_events WHERE analysis_run_id = $1 ORDER BY created_at ASC`, [runId]),
      this.pool.query(`SELECT a.id, a.risk_item_id AS "riskId", a.owner, TO_CHAR(a.due_date, 'YYYY-MM-DD') AS "dueDate", a.approval_note AS "approvalNote", a.status, a.verification_note AS "verificationNote", a.created_at AS "createdAt", a.verified_at AS "verifiedAt", r.title AS "riskTitle" FROM mock_actions a JOIN risk_items r ON r.id = a.risk_item_id WHERE a.analysis_run_id = $1 ORDER BY a.created_at DESC`, [runId]),
    ]);
    return {
      ...run.rows[0], sources: sources.rows, branches: branches.rows, risks: risks.rows, disagreement: disagreement.rows[0] ?? null,
      investigationPlan: planner.rows[0]?.plan ?? null, critic: critic.rows[0] ?? null, trace: trace.rows, actions: actions.rows,
    };
  }

  async getRiskForActor(riskId: string, actor: Actor): Promise<StoredRisk> {
    const result = await this.pool.query<StoredRisk>(
      `SELECT r.id, r.analysis_run_id AS "analysisRunId", r.category, r.title, r.explanation, r.impact, r.likelihood, r.severity, r.mitigation, r.uncertainty,
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

  async createMockAction(args: { riskId: string; actor: Actor; owner: string; dueDate: string; approvalNote: string }) {
    const result = await this.pool.query<{ riskId: string; runId: string }>(
      `SELECT r.id AS "riskId", r.analysis_run_id AS "runId" FROM risk_items r JOIN analysis_runs a ON a.id = r.analysis_run_id WHERE r.id = $1 AND a.organization_id = $2`,
      [args.riskId, args.actor.org_id],
    );
    const risk = result.rows[0];
    if (!risk) throw new AppError(404, "RISK_NOT_FOUND", "Risk not found");
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO mock_actions (id, risk_item_id, analysis_run_id, organization_id, approved_by, owner, due_date, approval_note, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,'approved')`,
      [id, risk.riskId, risk.runId, args.actor.org_id, args.actor.sub, args.owner, args.dueDate, args.approvalNote],
    );
    await this.recordTrace({ runId: risk.runId, skill: "Human Approval Gate", stage: "approve_action", status: "approved", detail: `Approved a mock mitigation action for owner ${args.owner}.`, metadata: { actionId: id, riskId: args.riskId, dueDate: args.dueDate } });
    await this.recordTrace({ runId: risk.runId, skill: "Action Skill", stage: "create_action", status: "completed", detail: "Created a reversible mock action card; no external project system was changed.", metadata: { actionId: id, riskId: args.riskId } });
    return { id, riskId: args.riskId, owner: args.owner, dueDate: args.dueDate, approvalNote: args.approvalNote, status: "approved" as const };
  }

  async verifyMockAction(args: { actionId: string; actor: Actor; outcome: "verified" | "failed"; note: string }) {
    const action = await this.pool.query<{ id: string; runId: string }>(
      `SELECT a.id, a.analysis_run_id AS "runId" FROM mock_actions a WHERE a.id = $1 AND a.organization_id = $2`,
      [args.actionId, args.actor.org_id],
    );
    const stored = action.rows[0];
    if (!stored) throw new AppError(404, "ACTION_NOT_FOUND", "Action not found");
    const status = args.outcome === "verified" ? "verified" : "replan_required";
    await this.pool.query(`UPDATE mock_actions SET status = $2, verification_note = $3, verified_at = NOW() WHERE id = $1`, [stored.id, status, args.note]);
    await this.recordTrace({ runId: stored.runId, skill: "Verification Skill", stage: "verify_action", status: args.outcome === "verified" ? "verified" : "failed", detail: args.note, metadata: { actionId: stored.id } });
    if (args.outcome === "failed") {
      await this.recordTrace({ runId: stored.runId, skill: "PreMortem Main Agent", stage: "replan", status: "replan", detail: "Verification failed, so the Main Agent requested a new mitigation plan.", metadata: { actionId: stored.id } });
    }
    return { id: stored.id, status, outcome: args.outcome };
  }
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import type { Comparison, EvidenceSource, PlanFacts, Scenario, Synthesis } from "./contracts.js";
import { Repository } from "./repository.js";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const staleEvidenceId = "44444444-4444-4444-8444-444444444444";
const evidenceAId = "55555555-5555-4555-8555-555555555555";
const evidenceBId = "66666666-6666-4666-8666-666666666666";

const actor = { sub: userId, org_id: orgId, role: "member" as const };

function scenario(category: Scenario["primaryCategory"], evidenceIds: string[]): Scenario {
  return {
    primaryCategory: category, contributingCategories: [], rootCause: "A root cause linked to a named dependency",
    narrative: "The sprint reaches its last days with validation delayed, dependency ownership unresolved, and not enough time to isolate a production-facing failure before the release window closes.",
    claims: [{ category, statement: "The plan has a material control gap with source-backed precedent.", evidenceIds, impact: 4, likelihood: 4, uncertainty: "moderate" }],
  };
}

function source(id: string, branch: "A" | "B", url: string): EvidenceSource {
  return {
    id, branch, url, hostname: new URL(url).hostname, title: "Primary incident lesson", publisher: "example.org",
    snippet: "A source-grounded incident lesson explaining why dependency validation and rollback ownership must be established early.",
    providerRank: 0.9, sourceTier: 1, status: "retrieved", retrievedAt: "2026-08-26T00:00:00.000Z",
  };
}

const facts: PlanFacts = {
  outcome: "Launch a partner API", timeline: "two weeks", team: "product and platform team", dependencies: ["external gateway"],
  technicalChanges: ["OAuth integration"], missingControls: ["rollback drill"],
};

describe("repository retry recovery with persistence", () => {
  it("removes failed-attempt artifacts before one successful retry persists the final record set", async () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    const { Pool } = database.adapters.createPg();
    const pool = new Pool();
    const migrations = ["001_initial.sql", "002_agentic_mvp.sql"].map((file) => readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
    for (const statement of migrations.join("\n").split(";").map((value) => value.trim()).filter(Boolean)) await pool.query(statement);
    const repo = new Repository(pool as any);

    await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Acme')`, [orgId]);
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, 'owner@example.test')`, [userId]);
    await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')`, [orgId, userId]);
    await pool.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'API Launch')`, [projectId, orgId]);

    const created = await repo.createOrReuseRun({
      projectId, actor, idempotencyKey: "77777777-7777-4777-8777-777777777777", policyVersion: "2026-08-01",
      plan: "Launch the partner API within two weeks, with an external gateway dependency and late end-to-end validation.",
    });
    const claimed = await repo.getRunForWorker(created.id);
    expect(claimed?.status).toBe("running");

    await repo.saveEvidence(created.id, [source(staleEvidenceId, "A", "https://example.org/stale")]);
    await pool.query(`INSERT INTO branch_runs (id, analysis_run_id, branch, primary_category, root_cause, scenario_json, status) VALUES ('88888888-8888-4888-8888-888888888888', $1, 'A', 'scope_control', 'stale A', '{}'::jsonb, 'succeeded'), ('99999999-9999-4999-8999-999999999999', $1, 'B', 'architecture_reliability', 'stale B', '{}'::jsonb, 'succeeded')`, [created.id]);
    await pool.query(`INSERT INTO disagreement_records (id, analysis_run_id, category_relation, claim_relation, evidence_overlap, display_status, explanation) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'different', 'contradicts', 0, 'meaningful_disagreement', 'stale')`, [created.id]);

    await repo.failRun(created.id, "ANALYSIS_FAILED");
    const reclaimed = await repo.getRunForWorker(created.id);
    expect(reclaimed?.status).toBe("running");
    await repo.clearTransientArtifacts(created.id);
    for (const table of ["evidence_sources", "branch_runs", "disagreement_records"]) {
      const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE analysis_run_id = $1`, [created.id]);
      expect(count.rows[0]?.count).toBe(0);
    }

    const finalSources = [source(evidenceAId, "A", "https://example.org/a"), source(evidenceBId, "B", "https://example.org/b")];
    const scenarioA = scenario("scope_control", [evidenceAId]);
    const scenarioB = scenario("architecture_reliability", [evidenceBId]);
    const comparison: Comparison = { categoryRelation: "different", semanticRelation: "contradicts", evidenceOverlap: 0, displayStatus: "meaningful_disagreement", explanation: "Independent evidence points to separate primary failure mechanisms." };
    const synthesis: Synthesis = { risks: [
      { category: "scope_control", title: "Validation is deferred", explanation: "Scope is not paired with early validation.", evidenceIds: [evidenceAId], impact: 4, likelihood: 4, mitigation: "Validate in the first milestone.", uncertainty: "moderate" },
      { category: "external_dependency", title: "Dependency owner is unclear", explanation: "The gateway owner needs an explicit commitment.", evidenceIds: [evidenceAId], impact: 4, likelihood: 3, mitigation: "Record ownership and escalation.", uncertainty: "moderate" },
      { category: "architecture_reliability", title: "Rollback is untested", explanation: "The integration has no proven recovery path.", evidenceIds: [evidenceBId], impact: 5, likelihood: 3, mitigation: "Run a rollback drill.", uncertainty: "high" },
    ] };
    await repo.saveEvidence(created.id, finalSources);
    await repo.completeRun({ runId: created.id, facts, scenarioA, scenarioB, comparison, synthesis });

    const finalEvidence = await pool.query(`SELECT COUNT(*)::int AS count FROM evidence_sources WHERE analysis_run_id = $1`, [created.id]);
    const finalBranches = await pool.query(`SELECT COUNT(*)::int AS count FROM branch_runs WHERE analysis_run_id = $1`, [created.id]);
    const finalDisagreement = await pool.query(`SELECT COUNT(*)::int AS count FROM disagreement_records WHERE analysis_run_id = $1`, [created.id]);
    const finalRisks = await pool.query(`SELECT COUNT(*)::int AS count FROM risk_items WHERE analysis_run_id = $1`, [created.id]);
    const finalRun = await pool.query(`SELECT status FROM analysis_runs WHERE id = $1`, [created.id]);
    expect(finalEvidence.rows[0]?.count).toBe(2);
    expect(finalBranches.rows[0]?.count).toBe(2);
    expect(finalDisagreement.rows[0]?.count).toBe(1);
    expect(finalRisks.rows[0]?.count).toBe(3);
    expect(finalRun.rows[0]?.status).toBe("succeeded");
    await pool.end();
  });
});

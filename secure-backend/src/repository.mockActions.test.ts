import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { Repository } from "./repository.js";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const riskId = "55555555-5555-4555-8555-555555555555";
const actor = { sub: userId, org_id: orgId, role: "admin" as const };
const approval = { owner: "Maria Chen", dueDate: "2026-10-11", approvalNote: "Approve the reversible gateway canary." };

async function seededRepo() {
  const database = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const migrations = ["001_initial.sql", "002_agentic_mvp.sql", "003_self_service_product.sql", "004_password_reset.sql"]
    .map((file) => readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
  for (const statement of migrations.join("\n").split(";").map((value) => value.trim()).filter(Boolean)) await pool.query(statement);
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Acme')`, [orgId]);
  await pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, 'owner@example.test', 'Owner')`, [userId]);
  await pool.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, 'Launch')`, [projectId, orgId]);
  await pool.query(
    `INSERT INTO analysis_runs (id, project_id, organization_id, requested_by, plan, status, idempotency_key, policy_version)
     VALUES ($1, $2, $3, $4, 'plan', 'succeeded', $5, '2026-08-01')`,
    [runId, projectId, orgId, userId, "66666666-6666-4666-8666-666666666666"],
  );
  await pool.query(
    `INSERT INTO risk_items (id, analysis_run_id, category, title, explanation, impact, likelihood, severity, mitigation, uncertainty)
     VALUES ($1, $2, 'scope_control', 'Validation is deferred', 'Late validation.', 4, 4, 4, 'Validate early.', 'moderate')`,
    [riskId, runId],
  );
  return { pool, repo: new Repository(pool as any) };
}

describe("mock action audit trail", () => {
  it("rejects a second approval while the first action for that risk is still open", async () => {
    const { pool, repo } = await seededRepo();
    await repo.createMockAction({ riskId, actor, ...approval });
    await expect(repo.createMockAction({ riskId, actor, ...approval })).rejects.toMatchObject({ status: 409, code: "ACTION_ALREADY_OPEN" });
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM mock_actions WHERE risk_item_id = $1`, [riskId]);
    expect(count.rows[0].n).toBe(1);
  });

  it("never lets a closed verification outcome be overwritten", async () => {
    const { pool, repo } = await seededRepo();
    const action = await repo.createMockAction({ riskId, actor, ...approval });
    await repo.verifyMockAction({ actionId: action.id, actor, outcome: "verified", note: "Canary passed in staging with alerting." });
    await expect(repo.verifyMockAction({ actionId: action.id, actor, outcome: "failed", note: "Trying to rewrite the outcome later." }))
      .rejects.toMatchObject({ status: 409, code: "ACTION_ALREADY_CLOSED" });
    const stored = await pool.query(`SELECT status, verification_note AS note FROM mock_actions WHERE id = $1`, [action.id]);
    expect(stored.rows[0]).toEqual({ status: "verified", note: "Canary passed in staging with alerting." });
  });

  it("still allows a fresh approval after a failed verification requests a replan", async () => {
    const { repo } = await seededRepo();
    const first = await repo.createMockAction({ riskId, actor, ...approval });
    await repo.verifyMockAction({ actionId: first.id, actor, outcome: "failed", note: "Rollback did not trigger the alert." });
    await expect(repo.createMockAction({ riskId, actor, ...approval })).resolves.toMatchObject({ status: "approved" });
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";
import { Repository } from "./repository.js";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

async function seededRepo() {
  const database = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const migrations = ["001_initial.sql", "002_agentic_mvp.sql", "003_self_service_product.sql", "004_password_reset.sql"]
    .map((file) => readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
  for (const statement of migrations.join("\n").split(";").map((value) => value.trim()).filter(Boolean)) await pool.query(statement);
  const repo = new Repository(pool as any);
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Acme')`, [orgId]);
  await pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, 'owner@example.test', 'Owner')`, [userId]);
  await pool.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, 'scrypt$aaaa$bbbb')`, [userId]);
  await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin')`, [orgId, userId]);
  return { pool, repo };
}

describe("password reset", () => {
  it("returns null for an email that does not exist, without creating a token", async () => {
    const { repo } = await seededRepo();
    const result = await repo.createPasswordResetToken("nobody@example.test");
    expect(result).toBeNull();
  });

  it("issues a single-use token that updates the password hash once", async () => {
    const { pool, repo } = await seededRepo();
    const created = await repo.createPasswordResetToken("OWNER@example.test");
    expect(created?.email).toBe("owner@example.test");
    expect(created?.token.length).toBeGreaterThan(20);

    const before = await pool.query(`SELECT password_hash FROM user_credentials WHERE user_id = $1`, [userId]);
    await repo.confirmPasswordReset(created!.token, "BrandNewPassword123");
    const after = await pool.query(`SELECT password_hash FROM user_credentials WHERE user_id = $1`, [userId]);
    expect(after.rows[0].password_hash).not.toBe(before.rows[0].password_hash);

    await expect(repo.confirmPasswordReset(created!.token, "AnotherPassword456")).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
  });

  it("rejects an unknown or already-expired token", async () => {
    const { repo } = await seededRepo();
    await expect(repo.confirmPasswordReset("not-a-real-token", "BrandNewPassword123")).rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
  });
});

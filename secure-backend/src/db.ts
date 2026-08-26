import { Pool, type PoolClient } from "pg";
import type { Config } from "./config.js";

export function createPool(config: Config) {
  return new Pool({ connectionString: config.DATABASE_URL, max: 12, idleTimeoutMillis: 30_000 });
}

export async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

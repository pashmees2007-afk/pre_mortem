import { createRequire } from "node:module";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { PreMortemEngine } from "./engine.js";
import { GroqClient } from "./groq.js";
import { createAnalysisQueue } from "./queue.js";
import { Repository } from "./repository.js";

const require = createRequire(import.meta.url);
const Redis = require("ioredis") as new (url: string, options: Record<string, unknown>) => {
  duplicate: () => unknown;
  quit: () => Promise<string>;
  eval: (...args: unknown[]) => Promise<unknown>;
};

export function createContainer() {
  const config = loadConfig();
  const pool = createPool(config);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  const repo = new Repository(pool);
  const groq = new GroqClient(config);
  const engine = new PreMortemEngine(repo, groq, config);
  const queue = createAnalysisQueue(redis);
  return { config, pool, redis: redis as any, repo, engine, queue };
}

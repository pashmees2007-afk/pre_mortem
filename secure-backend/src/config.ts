import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  GROQ_API_KEY: z.string().min(20),
  GROQ_RETRIEVAL_MODEL: z.string().min(3).default("groq/compound-mini"),
  GROQ_STRUCTURED_MODEL: z.string().min(3).default("openai/gpt-oss-20b"),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(25_000),
  MAX_PLAN_CHARS: z.coerce.number().int().min(500).max(30_000).default(12_000),
  ANALYSIS_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(3),
  ANALYSIS_RATE_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(source);
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Config } from "./config.js";
import { GeminiClient } from "./gemini.js";

const config: Config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://localhost/test", REDIS_URL: "redis://localhost:6379",
  GROQ_API_KEY: "test-groq-api-key-for-unit-tests-only-123", GROQ_RETRIEVAL_MODEL: "groq/compound-mini", GROQ_STRUCTURED_MODEL: "openai/gpt-oss-20b",
  GEMINI_API_KEY: "test-gemini-api-key-for-unit-tests-only-123", GEMINI_STRUCTURED_MODEL: "gemini-3.6-flash",
  JWT_SECRET: "this-is-a-test-secret-that-is-longer-than-thirty-two-characters", JWT_ISSUER: "premortem-api", JWT_AUDIENCE: "premortem-web",
  ANALYSIS_TIMEOUT_MS: 25_000, MAX_PLAN_CHARS: 12_000, ANALYSIS_RATE_LIMIT: 3, ANALYSIS_RATE_WINDOW_SECONDS: 600,
};

const Output = z.object({ outcome: z.string(), dependencies: z.array(z.string()) });
const schema = { type: "object", properties: { outcome: { type: "string" }, dependencies: { type: "array", items: { type: "string" } } }, required: ["outcome", "dependencies"] };

afterEach(() => vi.restoreAllMocks());

describe("GeminiClient", () => {
  it("sends schema-constrained JSON requests and validates returned data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ outcome: "Ship integration", dependencies: ["gateway"] }) }] } }],
    }), { status: 200 }));
    const result = await new GeminiClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" });
    expect(result).toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("gemini-3.6-flash:generateContent"), expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema } });
  });

  it("rejects malformed structured data before it reaches the agent workflow", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ outcome: "Missing dependency list" }) }] } }],
    }), { status: 200 }));
    await expect(new GeminiClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" })).rejects.toThrow("invalid result shape");
  });

  it("retries a transient free-tier quota response before validating the result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Quota exceeded. Please retry in 0.1s." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ outcome: "Ship integration", dependencies: ["gateway"] }) }] } }],
      }), { status: 200 }));
    await expect(new GeminiClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

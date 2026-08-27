import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Config } from "./config.js";
import { GroqClient } from "./groq.js";

const config: Config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://localhost/test", REDIS_URL: "redis://localhost:6379",
  GROQ_API_KEY: "test-groq-api-key-for-unit-tests-only-123", GROQ_RETRIEVAL_MODEL: "groq/compound-mini", GROQ_STRUCTURED_MODEL: "qwen/qwen3.8-27b",
  JWT_SECRET: "this-is-a-test-secret-that-is-longer-than-thirty-two-characters", JWT_ISSUER: "premortem-api", JWT_AUDIENCE: "premortem-web",
  ANALYSIS_TIMEOUT_MS: 25_000, MAX_PLAN_CHARS: 12_000, ANALYSIS_RATE_LIMIT: 3, ANALYSIS_RATE_WINDOW_SECONDS: 600,
};

const Output = z.object({ outcome: z.string(), dependencies: z.array(z.string()) });
const schema = { type: "object", properties: { outcome: { type: "string" }, dependencies: { type: "array", items: { type: "string" } } }, required: ["outcome", "dependencies"] };
const validResponse = { choices: [{ message: { content: JSON.stringify({ outcome: "Ship integration", dependencies: ["gateway"] }) } }] };
const ComparisonOutput = z.object({ semanticRelation: z.enum(["corroborates", "complements", "contradicts", "unresolved"]), explanation: z.string() }).strict();
const comparisonSchema = { type: "object", additionalProperties: false, properties: { semanticRelation: { type: "string" }, explanation: { type: "string" } }, required: ["semanticRelation", "explanation"] };
const SynthesisOutput = z.object({ risks: z.array(z.object({ title: z.string() })) }).strict();
const synthesisSchema = { type: "object", additionalProperties: false, properties: { risks: { type: "array", items: { type: "object" } } }, required: ["risks"] };

afterEach(() => vi.restoreAllMocks());

describe("GroqClient structured reasoning", () => {
  it("sends schema-constrained Qwen requests and validates returned data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));
    const result = await new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" });
    expect(result).toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledWith("https://api.groq.com/openai/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "qwen/qwen3.8-27b", response_format: { type: "json_schema", json_schema: { schema } } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages[0].content).toContain("OUTPUT CONTRACT");
  });

  it("rejects malformed structured data before it reaches the agent workflow", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: "Missing dependency list" }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: "Still missing dependency list" }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: "Still missing dependency list" }) } }] }), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" })).rejects.toThrow("invalid result shape");
  });

  it("repairs valid JSON that initially misses required typed fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ outcome: "Missing dependency list" }) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("regenerates a typed object when the initial Qwen response is truncated JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"outcome":"Truncated","dependencies":[' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to JSON-object mode when the provider rejects a JSON schema", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Generated JSON does not match the expected schema" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one Qwen request after the provider's token-rate retry hint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached for model. Please try again in 0ms." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one Qwen request after a decimal-second provider retry hint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached. Please try again in 9.495s." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses JSON-object mode first for a compact comparison stage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ semanticRelation: "complements", explanation: "The branches expose separate release risks." }) } }] }), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "scenario_comparison", schema: comparisonSchema, output: ComparisonOutput, system: "system", user: "scenarios", actorId: "actor", responseMode: "object" }))
      .resolves.toEqual({ semanticRelation: "complements", explanation: "The branches expose separate release risks." });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("uses JSON-object mode first for an evidence-limited risk synthesis stage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ risks: [{ title: "Rollback readiness" }, { title: "Partner dependency" }, { title: "Combined release risk" }] }) } }] }), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "risk_synthesis", schema: synthesisSchema, output: SynthesisOutput, system: "system", user: "scenarios", actorId: "actor", responseMode: "object" }))
      .resolves.toEqual({ risks: [{ title: "Rollback readiness" }, { title: "Partner dependency" }, { title: "Combined release risk" }] });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("validates an intact JSON object after accidental Qwen framing text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "Result follows:\n{\"outcome\":\"Ship integration\",\"dependencies\":[\"gateway\"]}" } }] }), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
  });
});

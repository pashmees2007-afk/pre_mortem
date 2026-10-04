import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Config } from "./config.js";
import { GroqClient, retryHintMs } from "./groq.js";

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

  it("adds reasoning headroom and a low reasoning effort for a GPT-OSS structured model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));
    await new GroqClient(config).strictJson({ model: "openai/gpt-oss-120b", name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor", maxCompletionTokens: 80 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "openai/gpt-oss-120b", max_completion_tokens: 880, reasoning_effort: "low" });
  });

  it("keeps Qwen's stage budget unchanged and sends no reasoning effort", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));
    await new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor", maxCompletionTokens: 700 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.max_completion_tokens).toBe(700);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("regenerates once when the provider cannot finish a JSON object in schema or object mode", async () => {
    const budgetExhausted = () => new Response(JSON.stringify({ error: { message: "Failed to validate JSON. Please adjust your prompt. See 'failed_generation' for more details." } }), { status: 400 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(budgetExhausted())
      .mockResolvedValueOnce(budgetExhausted())
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ model: "openai/gpt-oss-120b", name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor", maxCompletionTokens: 700 }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ response_format: { type: "json_object" }, reasoning_effort: "low" });
  });

  it("regenerates once when the provider reports it could not generate JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Failed to generate JSON. Please adjust your prompt." } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ model: "openai/gpt-oss-120b", name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor", maxCompletionTokens: 80 }))
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

  it("starts with zeroed usage totals", () => {
    expect(new GroqClient(config).getUsage()).toEqual({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("accumulates real provider-reported token usage across calls instead of inventing a cost figure", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...validResponse, usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...validResponse, usage: { prompt_tokens: 90, completion_tokens: 30, total_tokens: 120 } }), { status: 200 }));
    const client = new GroqClient(config);
    await client.strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" });
    await client.strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" });
    expect(client.getUsage()).toEqual({ requests: 2, promptTokens: 210, completionTokens: 70, totalTokens: 280 });
  });

  it("still counts the request when the provider omits a usage block, without fabricating token counts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(validResponse), { status: 200 }));
    const client = new GroqClient(config);
    await client.strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" });
    expect(client.getUsage()).toEqual({ requests: 1, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

describe("GroqClient web search", () => {
  const searchResponse = { choices: [{ message: { content: "findings", executed_tools: [] } }] };

  it("uses the browser_search tool for a GPT-OSS retrieval model, without Compound-only fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(searchResponse), { status: 200 }));
    await new GroqClient({ ...config, GROQ_RETRIEVAL_MODEL: "openai/gpt-oss-20b" }).webSearch({ query: "rollback", actorId: "actor", includeDomains: ["kubernetes.io"] });
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "openai/gpt-oss-20b", tools: [{ type: "browser_search" }], tool_choice: "required" });
    expect(body.compound_custom).toBeUndefined();
    expect(body.search_settings).toBeUndefined();
    expect(body.messages[0].content).toContain("kubernetes.io");
    expect((init?.headers as Record<string, string>)["Groq-Model-Version"]).toBeUndefined();
  });

  it("keeps the Compound web_search request for a groq/compound retrieval model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(searchResponse), { status: 200 }));
    await new GroqClient(config).webSearch({ query: "rollback", actorId: "actor", includeDomains: ["kubernetes.io"] });
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "groq/compound-mini", search_settings: { include_domains: ["kubernetes.io"] }, compound_custom: { tools: { enabled_tools: ["web_search"] } } });
    expect(body.tools).toBeUndefined();
    expect((init?.headers as Record<string, string>)["Groq-Model-Version"]).toBe("2025-07-23");
  });

  it("retries one web search after the provider's token-rate retry hint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached for model openai/gpt-oss-20b. Please try again in 1m2.5s." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(searchResponse), { status: 200 }));
    await new GroqClient({ ...config, GROQ_RETRIEVAL_MODEL: "openai/gpt-oss-20b" }).webSearch({ query: "rollback", actorId: "actor" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits out several per-minute limits in a row before giving the stage its answer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached on output tokens per minute (OTPM). Please try again in 16.5s." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached on output tokens per minute (OTPM). Please try again in 33.42s." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached on output tokens per minute (OTPM). Please try again in 12.7s." } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validResponse), { status: 200 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" }))
      .resolves.toEqual({ outcome: "Ship integration", dependencies: ["gateway"] });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops retrying after three per-minute waits", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Rate limit reached on output tokens per minute (OTPM). Please try again in 1s." } }), { status: 429 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" })).rejects.toThrow("OTPM");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops retrying once the total wait would pass 90 seconds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Rate limit reached on output tokens per minute (OTPM). Please try again in 50s." } }), { status: 429 }));
    await expect(new GroqClient(config).strictJson({ name: "plan_facts", schema, output: Output, system: "system", user: "plan", actorId: "actor" })).rejects.toThrow("OTPM");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast instead of waiting out a daily-quota hint measured in minutes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Rate limit reached on tokens per day (TPD). Please try again in 4m45.984s." } }), { status: 429 }));
    await expect(new GroqClient({ ...config, GROQ_RETRIEVAL_MODEL: "openai/gpt-oss-20b" }).webSearch({ query: "rollback", actorId: "actor" })).rejects.toThrow("tokens per day");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads minute, second, and millisecond retry hints", () => {
    expect(retryHintMs("Please try again in 1m2.5s.")).toBe(62_500);
    expect(retryHintMs("Please try again in 46.252s.")).toBeCloseTo(46_252);
    expect(retryHintMs("Please try again in 450ms.")).toBe(450);
    expect(retryHintMs("Please try again later.")).toBeNull();
  });
});

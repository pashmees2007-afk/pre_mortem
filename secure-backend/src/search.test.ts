import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import type { PlanFacts } from "./contracts.js";
import { UpstreamError } from "./errors.js";
import { retrieveEvidence } from "./evidence.js";
import { GroqClient } from "./groq.js";
import { createSearcher, TavilyClient } from "./search.js";

const config: Config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://localhost/test", REDIS_URL: "redis://localhost:6379",
  GROQ_API_KEY: "test-groq-api-key-for-unit-tests-only-123", GROQ_RETRIEVAL_MODEL: "openai/gpt-oss-120b", GROQ_STRUCTURED_MODEL: "qwen/qwen3.8-27b",
  JWT_SECRET: "this-is-a-test-secret-that-is-longer-than-thirty-two-characters", JWT_ISSUER: "premortem-api", JWT_AUDIENCE: "premortem-web",
  ANALYSIS_TIMEOUT_MS: 25_000, MAX_PLAN_CHARS: 12_000, ANALYSIS_RATE_LIMIT: 3, ANALYSIS_RATE_WINDOW_SECONDS: 600,
};
const tavilyConfig = { ...config, TAVILY_API_KEY: "tvly-test-key-for-unit-tests" };

const facts: PlanFacts = {
  outcome: "Migrate a production service to Kubernetes",
  timeline: "three weeks",
  team: "SRE",
  dependencies: ["DNS approval"],
  technicalChanges: ["Containerise the service"],
  missingControls: ["Rehearsed rollback"],
};

function tavilyResponse(results: Array<{ url: string; title: string; content: string; score?: number }>) {
  return new Response(JSON.stringify({ query: "q", results, response_time: 0.4 }), { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe("Tavily evidence search", () => {
  it("sends a basic-depth search with the bare query and the enforced domain list, never the LLM instruction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tavilyResponse([]));
    await new TavilyClient(tavilyConfig).webSearch({
      query: "rollback   rehearsal", instruction: "Find official guidance.", actorId: "actor", includeDomains: ["kubernetes.io"],
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.tavily.com/search", expect.objectContaining({ method: "POST" }));
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tvly-test-key-for-unit-tests");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: "rollback rehearsal", search_depth: "basic", include_domains: ["kubernetes.io"], include_answer: false, include_raw_content: false,
    });
  });

  it("trims queries to Tavily's 400-character limit and omits an empty domain list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(tavilyResponse([]));
    await new TavilyClient(tavilyConfig).webSearch({ query: "x".repeat(900), actorId: "actor" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.query).toHaveLength(400);
    expect(body.include_domains).toBeUndefined();
  });

  it("feeds Tavily results through the same evidence checks as Groq search, without spending Groq requests", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tavilyResponse([
        { url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/", title: "Deployments", content: "Deployments support controlled rollout and rollback of workloads.", score: 0.91 },
        { url: "http://kubernetes.io/insecure", title: "Insecure", content: "Plain-HTTP pages are never retained as evidence records." },
        { url: "https://learn.microsoft.com/en-us/azure/well-architected/reliability/", title: "Reliability principles", content: "Design for recovery with tested rollback and failure-mode analysis.", score: 0.8 },
      ]));
    const tavily = new TavilyClient(tavilyConfig);

    const sources = await retrieveEvidence({ client: tavily, facts, branch: "A", actorId: "actor", topic: "engineering" });

    expect(sources.map((source) => source.hostname)).toEqual(["kubernetes.io", "learn.microsoft.com"]);
    expect(sources[0]).toMatchObject({ title: "Deployments", providerRank: 0.91, sourceTier: 1 });
    expect(tavily.getSearchCount()).toBe(1);
  });

  it("surfaces a Tavily rejection as an upstream error and does not count it as a search", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: { error: "Unauthorized: missing or invalid API key." } }), { status: 401 }));
    const tavily = new TavilyClient(tavilyConfig);
    const failure = tavily.webSearch({ query: "rollback", actorId: "actor" });
    await expect(failure).rejects.toBeInstanceOf(UpstreamError);
    await expect(failure).rejects.toThrow("invalid API key");
    expect(tavily.getSearchCount()).toBe(0);
  });

  it("keeps a usage-limit response distinguishable as a rate limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: { error: "Rate limit exceeded" } }), { status: 429 }));
    await expect(new TavilyClient(tavilyConfig).webSearch({ query: "rollback", actorId: "actor" })).rejects.toMatchObject({ status: 429 });
  });
});

describe("searcher selection", () => {
  it("uses Tavily only when TAVILY_API_KEY is configured, otherwise the Groq retrieval model", () => {
    const groq = new GroqClient(config);
    expect(createSearcher(config, groq)).toBe(groq);
    const tavily = createSearcher(tavilyConfig, groq);
    expect(tavily).toBeInstanceOf(TavilyClient);
    expect(tavily.sharesGroqBudget).toBe(false);
    expect(groq.sharesGroqBudget).toBe(true);
  });

  it("still gives a Groq searcher the instruction text in front of the query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok", executed_tools: [] } }] }), { status: 200 }));
    await new GroqClient(config).webSearch({ query: "rollback rehearsal", instruction: "Find official guidance.", actorId: "actor" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content).toContain("QUERY: Find official guidance. rollback rehearsal");
  });
});

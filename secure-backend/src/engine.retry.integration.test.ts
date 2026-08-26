import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import { PreMortemEngine } from "./engine.js";

const runId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";

const config: Config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://localhost/test", REDIS_URL: "redis://localhost:6379",
  GROQ_API_KEY: "test-groq-api-key-for-unit-tests-only-123", GROQ_RETRIEVAL_MODEL: "groq/compound-mini", GROQ_STRUCTURED_MODEL: "openai/gpt-oss-20b",
  JWT_SECRET: "this-is-a-test-secret-that-is-longer-than-thirty-two-characters", JWT_ISSUER: "premortem-api", JWT_AUDIENCE: "premortem-web",
  ANALYSIS_TIMEOUT_MS: 25_000, MAX_PLAN_CHARS: 12_000, ANALYSIS_RATE_LIMIT: 3, ANALYSIS_RATE_WINDOW_SECONDS: 600,
};

const run = {
  id: runId, projectId: "33333333-3333-4333-8333-333333333333", organizationId: "44444444-4444-4444-8444-444444444444",
  requestedBy: actorId, plan: "Launch the partner OAuth integration in two weeks. The external gateway is owned by another team, and signed webhook validation is delayed to the final two days.",
  status: "running" as const, policyVersion: "2026-08-01",
};

const facts = {
  outcome: "Launch the partner OAuth integration", timeline: "two weeks", team: "one product team", dependencies: ["external gateway"],
  technicalChanges: ["OAuth integration", "signed webhooks"], missingControls: ["early webhook validation"],
};

function scenario(category: "scope_control" | "architecture_reliability", evidenceIds: string[]) {
  return {
    primaryCategory: category, contributingCategories: [], rootCause: "A clear root cause tied to a plan dependency",
    narrative: "The sprint ends with integration validation delayed until the external gateway changes unexpectedly, leaving too little time to isolate the behavior, align ownership, and establish a safe rollback path before the promised release date.",
    claims: [{ category, statement: "The dependency is not paired with an early, owned validation control.", evidenceIds, impact: 4, likelihood: 4, uncertainty: "moderate" as const }],
  };
}

function idsFromPrompt(user: string) {
  return [...user.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi)].map((match) => match[0]).slice(0, 2);
}

const providerSearch = {
  choices: [{ message: { executed_tools: [{ search_results: { results: [
    { url: "https://sre.google/example-one", title: "Primary incident lesson", content: "A primary incident report on dependency validation and rollback ownership.", score: 0.9 },
    { url: "https://github.blog/example-two", title: "Engineering reliability lesson", content: "An engineering incident report on integration checks completed too late.", score: 0.8 },
  ] } }] } }],
};

describe("engine retry recovery", () => {
  it("reclaims a failed run, clears transient state, and completes once without duplicate evidence artifacts", async () => {
    const repo = {
      getRunForWorker: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(run),
      clearTransientArtifacts: vi.fn().mockResolvedValue(undefined),
      saveInvestigationPlan: vi.fn().mockResolvedValue(undefined),
      saveCritic: vi.fn().mockResolvedValue(undefined),
      recordTrace: vi.fn().mockResolvedValue(undefined),
      saveEvidence: vi.fn().mockResolvedValue(undefined),
      completeRun: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn().mockResolvedValue(undefined),
    };
    const groq = {
      webSearch: vi.fn().mockRejectedValueOnce(new Error("temporary retrieval outage")).mockResolvedValue(providerSearch),
      strictJson: vi.fn(async (args: { name: string; user: string }) => {
        if (args.name === "plan_facts") return facts;
        if (args.name === "investigation_plan") return { summary: "Inspect delivery timing and rollback readiness with independent evidence branches.", angles: [{ category: "scope_control", branch: "A", reason: "Late validation may consume the remaining delivery buffer." }, { category: "architecture_reliability", branch: "B", reason: "Rollback readiness is not proven in the plan." }], researchQueries: { A: "delivery capacity validation postmortem", B: "rollback readiness integration postmortem" } };
        if (args.name === "scenario_a") return scenario("scope_control", idsFromPrompt(args.user));
        if (args.name === "scenario_b") return scenario("architecture_reliability", idsFromPrompt(args.user));
        if (args.name === "scenario_comparison") return { semanticRelation: "contradicts", explanation: "The branches identify separate primary mechanisms." };
        if (args.name === "evidence_critic") return { finding: "The plan does not prove the gateway configuration lead time.", evidenceGaps: ["No dated gateway commitment."], nextCheck: "Request a written configuration date." };
        if (args.name === "risk_synthesis") {
          const [first] = idsFromPrompt(args.user);
          return { risks: [
            { category: "scope_control", title: "Delivery scope exceeds validation capacity", explanation: "Validation is delayed until the end of the sprint.", evidenceIds: [first], impact: 4, likelihood: 4, mitigation: "Move validation into the first milestone.", uncertainty: "moderate" },
            { category: "external_dependency", title: "Gateway ownership is unresolved", explanation: "The dependency needs an explicit support agreement.", evidenceIds: [first], impact: 4, likelihood: 3, mitigation: "Name the gateway owner and escalation path.", uncertainty: "moderate" },
            { category: "architecture_reliability", title: "Webhook path lacks an early safety check", explanation: "The rollback path has not been exercised.", evidenceIds: [first], impact: 5, likelihood: 3, mitigation: "Run a signed webhook canary and rollback drill.", uncertainty: "high" },
          ] };
        }
        throw new Error(`Unexpected schema request: ${args.name}`);
      }),
    };
    const engine = new PreMortemEngine(repo as any, groq as any, config);

    await expect(engine.run(runId)).rejects.toThrow("temporary retrieval outage");
    await engine.run(runId);

    expect(repo.failRun).toHaveBeenCalledWith(runId, "ANALYSIS_FAILED");
    expect(repo.clearTransientArtifacts).toHaveBeenCalledTimes(2);
    expect(repo.saveEvidence).toHaveBeenCalledTimes(1);
    expect(repo.saveEvidence.mock.calls[0]?.[1]).toHaveLength(2);
    expect(repo.completeRun).toHaveBeenCalledTimes(1);
    expect(repo.completeRun.mock.calls[0]?.[0]).toMatchObject({ runId, facts });
  });
});

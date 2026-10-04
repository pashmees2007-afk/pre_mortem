import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import type { EvidenceSource, InvestigationPlan, PlanFacts, Scenario, Synthesis } from "./contracts.js";
import { PreMortemEngine, fallbackScenario, labelEvidence } from "./engine.js";
import { UpstreamError } from "./errors.js";

const runId = "11111111-1111-4111-8111-111111111111";
const config: Config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://localhost/test", REDIS_URL: "redis://localhost:6379",
  GROQ_API_KEY: "test-groq-api-key-for-unit-tests-only-123", GROQ_RETRIEVAL_MODEL: "groq/compound-mini", GROQ_STRUCTURED_MODEL: "qwen/qwen3.8-27b",
  JWT_SECRET: "this-is-a-test-secret-that-is-longer-than-thirty-two-characters", JWT_ISSUER: "premortem-api", JWT_AUDIENCE: "premortem-web",
  ANALYSIS_TIMEOUT_MS: 25_000, MAX_PLAN_CHARS: 12_000, ANALYSIS_RATE_LIMIT: 3, ANALYSIS_RATE_WINDOW_SECONDS: 600,
};
const run = {
  id: runId, projectId: "33333333-3333-4333-8333-333333333333", organizationId: "44444444-4444-4444-8444-444444444444",
  requestedBy: "22222222-2222-4222-8222-222222222222", status: "running" as const, policyVersion: "2026-08-01",
  plan: "Move the notification service to Kubernetes in three weeks. Rollback has not been rehearsed and there is no plan for draining in-flight jobs.",
};
const facts: PlanFacts = {
  outcome: "Move the notification service to Kubernetes", timeline: "three weeks", team: "SRE", dependencies: ["DNS cutover"],
  technicalChanges: ["Containerise the service"], missingControls: ["a rehearsed rollback procedure", "a plan for draining in-flight jobs"],
};
const plan: InvestigationPlan = {
  summary: "Inspect rollback readiness and delivery capacity with independent evidence branches.",
  angles: [{ category: "operational_readiness", branch: "A", reason: "Rollback has not been rehearsed." }, { category: "delivery_capacity", branch: "B", reason: "SRE time is limited to four days." }],
  researchQueries: { A: "kubernetes rollback readiness guidance", B: "migration capacity planning postmortem" },
};
const search = { choices: [{ message: { executed_tools: [{ search_results: { results: [
  { url: "https://kubernetes.io/docs/rollback", title: "Rollback guidance", content: "Official guidance on rolling back a Kubernetes deployment safely.", score: 0.9 },
  { url: "https://learn.microsoft.com/aks/stateful", title: "Stateful workloads", content: "Guidance on migrating stateful workloads and draining queues before cutover.", score: 0.8 },
  { url: "https://sre.google/workbook/canarying", title: "Canarying releases", content: "Staged rollouts limit the impact of a bad change and keep rollback cheap.", score: 0.85 },
  { url: "https://github.blog/engineering/migrations", title: "Migration lessons", content: "An engineering report on migrations that ran short of operator time.", score: 0.75 },
] } }] } }] };

const labelsIn = (user: string) => [...user.matchAll(/"id":"(E\d+)"/g)].map((match) => match[1]!);
const scenario = (category: string, evidenceIds: string[]) => ({
  primaryCategory: category, contributingCategories: [], rootCause: "Rollback readiness is not demonstrated.",
  narrative: "The migration can strand in-flight notifications because rollback has never been rehearsed and nobody owns draining the queue before cutover.",
  claims: [{ category, statement: "Rollback has not been rehearsed before cutover.", evidenceIds, impact: 5, likelihood: 4, uncertainty: "moderate" }],
});
const risks = (evidenceIds: string[]) => ({ risks: ["Unrehearsed rollback", "Queue draining has no owner", "SRE time is too short"].map((title) => ({
  category: "operational_readiness", title, explanation: "The plan does not demonstrate this control before cutover.", evidenceIds,
  impact: 5, likelihood: 4, mitigation: "Rehearse it in staging with a named owner before cutover.", uncertainty: "moderate",
})) });

function harness(overrides: Record<string, (user: string) => unknown> = {}) {
  const repo = {
    getRunForWorker: vi.fn().mockResolvedValue(run), clearTransientArtifacts: vi.fn(), saveInvestigationPlan: vi.fn(), saveCritic: vi.fn(),
    recordTrace: vi.fn(), saveEvidence: vi.fn(), completeRun: vi.fn(), failRun: vi.fn(),
  };
  const defaults: Record<string, (user: string) => unknown> = {
    plan_facts: () => facts,
    investigation_plan: () => plan,
    scenario_a: (user) => scenario("operational_readiness", labelsIn(user).slice(0, 1)),
    scenario_b: (user) => scenario("delivery_capacity", labelsIn(user).slice(0, 1)),
    scenario_comparison: () => ({ semanticRelation: "complements", explanation: "The branches name different mechanisms." }),
    evidence_critic: () => ({ finding: "Rollback readiness is asserted, not shown.", evidenceGaps: ["No rehearsal record."], nextCheck: "Ask for the rehearsal log." }),
    risk_synthesis: (user) => risks(labelsIn(user).slice(0, 2)),
  };
  const answers = { ...defaults, ...overrides };
  const groq = {
    getUsage: vi.fn().mockReturnValue({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    webSearch: vi.fn().mockResolvedValue(search),
    strictJson: vi.fn(async (args: { name: string; user: string }) => answers[args.name]!(args.user)),
  };
  const engine = new PreMortemEngine(repo as any, groq as any, config);
  const stored = () => repo.saveEvidence.mock.calls[0]?.[1] as EvidenceSource[];
  const completed = () => repo.completeRun.mock.calls[0]?.[0] as { scenarioA: Scenario; scenarioB: Scenario; synthesis: Synthesis };
  const trace = (skill: string) => repo.recordTrace.mock.calls.map((call) => call[0]).find((event) => event.skill === skill);
  return { engine, repo, groq, stored, completed, trace };
}

describe("evidence labels", () => {
  it("numbers evidence E1, E2, ... and maps each label back to its source", () => {
    const labels = labelEvidence([{ id: "a" }, { id: "b" }] as EvidenceSource[]);
    expect(labels.toLabel.get("b")).toBe("E2");
    expect(labels.toId.get("E1")).toBe("a");
  });

  it("stores the real evidence IDs behind the labels the model cited", async () => {
    const { engine, stored, completed, trace } = harness();
    await engine.run(runId);
    const ids = new Set(stored().map((source) => source.id));
    const cited = [...completed().scenarioA.claims, ...completed().scenarioB.claims].flatMap((claim) => claim.evidenceIds)
      .concat(completed().synthesis.risks.flatMap((risk) => risk.evidenceIds));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.every((id) => ids.has(id))).toBe(true);
    expect(trace("Independent Scenario Agents")).toMatchObject({ status: "completed", metadata: { fallback: false } });
    expect(trace("Decision Skill")).toMatchObject({ metadata: { fallback: false } });
  });
});

describe("scenario fallback", () => {
  it("replaces a scenario that cites an unknown label instead of failing the run", async () => {
    const { engine, repo, stored, completed, trace } = harness({ scenario_a: () => scenario("operational_readiness", ["E9"]) });
    await engine.run(runId);
    expect(repo.failRun).not.toHaveBeenCalled();
    const branchA = new Set(stored().filter((source) => source.branch === "A").map((source) => source.id));
    expect(completed().scenarioA.narrative).toContain("Rule-based scenario for branch A");
    expect(completed().scenarioA.claims.every((claim) => claim.evidenceIds.every((id) => branchA.has(id)))).toBe(true);
    expect(trace("Independent Scenario Agents")).toMatchObject({ status: "attention", metadata: { fallback: true, fallbackBranches: ["A"] } });
  });

  it("replaces a scenario the provider could not validate at all", async () => {
    const { engine, repo, completed } = harness({ scenario_b: () => { throw new UpstreamError("scenario_b: the analysis provider returned an invalid result shape"); } });
    await engine.run(runId);
    expect(repo.failRun).not.toHaveBeenCalled();
    expect(completed().scenarioB.primaryCategory).toBe("delivery_capacity");
  });

  it("builds a valid scenario from the plan's facts and this branch's evidence only", () => {
    const evidence = [{ id: "5d1f6f1e-0000-4000-8000-000000000001", branch: "B", status: "retrieved", sourceTier: 1 }] as EvidenceSource[];
    const result = fallbackScenario({ branch: "B", facts, plan, evidence })!;
    expect(result.primaryCategory).toBe("delivery_capacity");
    expect(result.claims.map((claim) => claim.statement)).toEqual(["The plan does not yet show a rehearsed rollback procedure.", "The plan does not yet show a plan for draining in-flight jobs."]);
    expect(result.claims.every((claim) => claim.evidenceIds[0] === evidence[0]!.id && claim.uncertainty === "high")).toBe(true);
    expect(fallbackScenario({ branch: "B", facts, plan, evidence: [] })).toBeNull();
  });
});

describe("synthesis labels", () => {
  it("uses the evidence-preserving fallback when the synthesis cites an unknown label", async () => {
    const { engine, repo, trace } = harness({ risk_synthesis: () => risks(["E42"]) });
    await engine.run(runId);
    expect(repo.failRun).not.toHaveBeenCalled();
    expect(trace("Decision Skill")).toMatchObject({ status: "attention", metadata: { fallback: true } });
  });
});

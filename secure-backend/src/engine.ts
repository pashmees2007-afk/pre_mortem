import type { Config } from "./config.js";
import {
  ComparatorSchema,
  ControlAssessmentSchema,
  EvidenceSourceSchema,
  PlanFactsSchema,
  ScenarioSchema,
  SynthesisSchema,
  type EvidenceSource,
} from "./contracts.js";
import { retrieveEvidence } from "./evidence.js";
import { AppError } from "./errors.js";
import { GroqClient } from "./groq.js";
import { SYSTEM, dataBlock } from "./prompts.js";
import { type Repository } from "./repository.js";
import { classifyComparison, rescoreSeverity } from "./scoring.js";

function evidenceCards(sources: EvidenceSource[]) {
  return sources.filter((source) => source.status === "retrieved" && source.sourceTier < 4).map((source) => ({
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    snippet: source.snippet,
    tier: source.sourceTier,
  }));
}

function assertEvidenceReferences(referenceIds: string[], allowedSources: EvidenceSource[]) {
  const allowed = new Set(allowedSources.map((source) => source.id));
  if (!referenceIds.length || referenceIds.some((id) => !allowed.has(id))) {
    throw new AppError(502, "UNSUPPORTED_CITATION", "A model returned an unverified evidence reference");
  }
}

function deDuplicateAcrossBranches(left: EvidenceSource[], right: EvidenceSource[]) {
  const canonical = new Map(left.map((source) => [source.url, source.id]));
  const normalizedRight = right.map((source) => {
    const id = canonical.get(source.url);
    return id ? { ...source, id } : source;
  });
  const stored = Array.from(new Map([...left, ...normalizedRight].map((source) => [source.id, source])).values());
  return { left, right: normalizedRight, stored };
}

export class PreMortemEngine {
  constructor(
    private readonly repo: Repository,
    private readonly groq: GroqClient,
    private readonly config: Config,
  ) {}

  async run(runId: string) {
    const run = await this.repo.getRunForWorker(runId);
    if (!run) return; // A duplicate queue delivery or previously processed idempotency key.
    try {
      await this.repo.clearTransientArtifacts(run.id);
      const facts = await this.groq.strictJson({
        name: "plan_facts",
        schema: (await import("./contracts.js")).jsonSchemas.planFacts,
        output: PlanFactsSchema,
        system: SYSTEM.normalize,
        user: dataBlock("PLAN_DATA", run.plan),
        actorId: run.requestedBy,
        maxCompletionTokens: 900,
      });

      const [evidenceA, evidenceB] = await Promise.all([
        retrieveEvidence({ client: this.groq, facts, branch: "A", actorId: run.requestedBy }),
        retrieveEvidence({ client: this.groq, facts, branch: "B", actorId: run.requestedBy }),
      ]);
      if (evidenceA.length < 2 || evidenceB.length < 2) {
        throw new AppError(502, "EVIDENCE_INSUFFICIENT", "Enough verifiable evidence could not be retrieved for independent analysis");
      }
      const sources = deDuplicateAcrossBranches(evidenceA, evidenceB);
      for (const source of sources.stored) EvidenceSourceSchema.parse(source);
      await this.repo.saveEvidence(run.id, sources.stored);

      const [scenarioA, scenarioB] = await Promise.all([
        this.createScenario(run.plan, facts, sources.left, "A", run.requestedBy),
        this.createScenario(run.plan, facts, sources.right, "B", run.requestedBy),
      ]);
      const semantic = await this.groq.strictJson({
        name: "scenario_comparison",
        schema: (await import("./contracts.js")).jsonSchemas.comparator,
        output: ComparatorSchema,
        system: SYSTEM.comparator,
        user: [dataBlock("SCENARIO_A", scenarioA), dataBlock("SCENARIO_B", scenarioB)].join("\n"),
        actorId: run.requestedBy,
        maxCompletionTokens: 600,
      });
      const comparison = classifyComparison(scenarioA, scenarioB, semantic);

      const allowedEvidence = sources.stored.filter((source) => source.status === "retrieved" && source.sourceTier < 4);
      const synthesis = await this.groq.strictJson({
        name: "risk_synthesis",
        schema: (await import("./contracts.js")).jsonSchemas.synthesis,
        output: SynthesisSchema,
        system: SYSTEM.synthesis,
        user: [
          dataBlock("PLAN_FACTS", facts),
          dataBlock("SCENARIO_A", scenarioA),
          dataBlock("SCENARIO_B", scenarioB),
          dataBlock("COMPARISON", comparison),
          dataBlock("ALLOWED_EVIDENCE", evidenceCards(allowedEvidence)),
        ].join("\n"),
        actorId: run.requestedBy,
        maxCompletionTokens: 1_400,
      });
      for (const risk of synthesis.risks) assertEvidenceReferences(risk.evidenceIds, allowedEvidence);
      await this.repo.completeRun({ runId: run.id, facts, scenarioA, scenarioB, comparison, synthesis });
    } catch (error) {
      await this.repo.failRun(run.id, error instanceof AppError ? error.code : "ANALYSIS_FAILED");
      throw error;
    }
  }

  private async createScenario(plan: string, facts: unknown, evidence: EvidenceSource[], branch: "A" | "B", actorId: string) {
    const scenario = await this.groq.strictJson({
      name: `scenario_${branch.toLowerCase()}`,
      schema: (await import("./contracts.js")).jsonSchemas.scenario,
      output: ScenarioSchema,
      system: SYSTEM.scenario(branch),
      user: [dataBlock("PLAN_DATA", plan), dataBlock("PLAN_FACTS", facts), dataBlock("EVIDENCE_CARDS", evidenceCards(evidence))].join("\n"),
      actorId,
      maxCompletionTokens: 1_300,
    });
    for (const claim of scenario.claims) assertEvidenceReferences(claim.evidenceIds, evidence);
    return scenario;
  }

  async assessMitigation(args: { riskId: string; actor: { sub: string; org_id: string; role: "member" | "admin" }; answer: string }) {
    const risk = await this.repo.getRiskForActor(args.riskId, args.actor);
    const assessment = await this.groq.strictJson({
      name: "control_assessment",
      schema: (await import("./contracts.js")).jsonSchemas.controlAssessment,
      output: ControlAssessmentSchema,
      system: SYSTEM.control,
      user: [
        dataBlock("RISK", { title: risk.title, mitigation: risk.mitigation, severity: risk.severity }),
        dataBlock("TEAM_ANSWER", args.answer),
        dataBlock("CONTROL_CRITERIA", ["named owner", "test evidence", "rollback or fallback", "monitoring signal"]),
      ].join("\n"),
      actorId: args.actor.sub,
      maxCompletionTokens: 700,
    });
    const scoring = rescoreSeverity(risk.severity, assessment.evidence);
    await this.repo.saveMitigation({
      riskId: risk.id, actor: args.actor, answer: args.answer, evidence: assessment.evidence,
      rationale: assessment.rationale, gaps: assessment.gaps, before: scoring.before, after: scoring.after,
    });
    return { assessment, ...scoring };
  }
}

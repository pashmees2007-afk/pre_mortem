import type { Config } from "./config.js";
import {
  ComparatorSchema,
  ControlAssessmentSchema,
  CriticSchema,
  EvidenceSourceSchema,
  InvestigationPlanSchema,
  PlanFactsSchema,
  ScenarioSchema,
  SynthesisSchema,
  type Comparison,
  type CriticFinding,
  type EvidenceSource,
  type InvestigationPlan,
  type PlanFacts,
  type Scenario,
  type Synthesis,
} from "./contracts.js";
import { retrieveEvidence } from "./evidence.js";
import { AppError, UpstreamError } from "./errors.js";
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

const GROQ_EVIDENCE_COOLDOWN_MS = 62_000;
const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function fallbackComparison(a: Scenario, b: Scenario) {
  const categoryRelation = a.primaryCategory === b.primaryCategory ? "corroborates" : "complements";
  return {
    semanticRelation: categoryRelation,
    explanation: `Branch A focuses on ${a.primaryCategory}, while Branch B focuses on ${b.primaryCategory}; both are retained as independent evidence-limited failure hypotheses.`,
  } satisfies Pick<Comparison, "semanticRelation" | "explanation">;
}

function fallbackCritic(args: { plan: InvestigationPlan; comparison: Comparison; evidence: EvidenceSource[] }): CriticFinding {
  const missingTrustedBranches = (["A", "B"] as const).filter((branch) => !args.evidence.some((source) => source.branch === branch && source.sourceTier === 1));
  const evidenceGaps = missingTrustedBranches.length
    ? missingTrustedBranches.map((branch) => `Research branch ${branch} retained no tier-one engineering guidance.`)
    : args.comparison.evidenceOverlap >= 0.5
      ? ["The branches share substantial evidence and need an additional independent check."]
      : [];
  return {
    finding: `Evidence review retained ${args.evidence.length} verifiable sources across independent research branches; the remaining gap is source independence and operational validation.`,
    evidenceGaps,
    nextCheck: `Ask the accountable owner to validate the highest-impact control before release, focusing on the ${args.plan.angles[0]?.category ?? "identified"} risk angle.`,
  };
}

function fallbackSynthesis(a: Scenario, b: Scenario, comparison: Comparison): Synthesis {
  const scenarioRisk = (scenario: Scenario, label: string): Synthesis["risks"][number] => {
    const claims = scenario.claims;
    const evidenceIds = [...new Set(claims.flatMap((claim) => claim.evidenceIds))].slice(0, 4);
    const highestImpact = Math.max(...claims.map((claim) => claim.impact));
    const highestLikelihood = Math.max(...claims.map((claim) => claim.likelihood));
    const uncertainty: Scenario["claims"][number]["uncertainty"] = claims.some((claim) => claim.uncertainty === "high") ? "high" : claims.some((claim) => claim.uncertainty === "moderate") ? "moderate" : "low";
    return {
      category: scenario.primaryCategory,
      title: `${label}: ${scenario.primaryCategory.replaceAll("_", " ")} risk`,
      explanation: `${scenario.rootCause} ${scenario.narrative}`.slice(0, 500),
      evidenceIds,
      impact: highestImpact,
      likelihood: highestLikelihood,
      mitigation: `Assign a named owner to test and evidence the control for this ${scenario.primaryCategory.replaceAll("_", " ")} risk before release.`,
      uncertainty,
    };
  };
  const branchA = scenarioRisk(a, "Branch A");
  const branchB = scenarioRisk(b, "Branch B");
  return {
    risks: [
      branchA,
      branchB,
      {
        category: a.primaryCategory,
        title: "Combined release-readiness risk",
        explanation: `The independent branches ${comparison.semanticRelation} each other: ${comparison.explanation}`.slice(0, 500),
        evidenceIds: [...new Set([...branchA.evidenceIds, ...branchB.evidenceIds])].slice(0, 4),
        impact: Math.max(branchA.impact, branchB.impact),
        likelihood: Math.max(branchA.likelihood, branchB.likelihood),
        mitigation: "Do not approve release until owners demonstrate the named controls, rollback behavior, and monitoring signals in a testable environment.",
        uncertainty: branchA.uncertainty === "high" || branchB.uncertainty === "high" ? "high" : branchA.uncertainty === "moderate" || branchB.uncertainty === "moderate" ? "moderate" : "low",
      },
    ],
  };
}

function fallbackControlAssessment(answer: string): { evidence: "verified" | "partial" | "unverified" | "absent"; rationale: string; gaps: string[] } {
  const lower = answer.toLowerCase();
  const gaps = [
    ["named accountable owner", /owner|accountable|lead/],
    ["repeatable payment and webhook test evidence", /test|staged|staging|evidence/],
    ["rollback or reconciliation evidence", /rollback|reconcil/],
    ["monitoring signal or alert evidence", /monitor|alert/],
  ].filter(([, pattern]) => !(pattern as RegExp).test(lower)).map(([gap]) => `Provide ${gap}.`);
  return {
    evidence: "unverified",
    rationale: "Provider control-assessment output was invalid. The human answer describes planned controls, but no independently verifiable test artifact or monitoring result was supplied.",
    gaps: gaps.length ? gaps : ["Attach a completed test record or monitoring result before the risk can be treated as verified."],
  };
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
        maxCompletionTokens: 400,
      });

      await this.repo.recordTrace({
        runId: run.id,
        skill: "PreMortem Main Agent",
        stage: "normalize_plan",
        status: "completed",
        detail: "Extracted the project outcome, timeline, team, dependencies, technical changes, and missing controls.",
      });

      const investigationPlan = await this.groq.strictJson({
        name: "investigation_plan",
        schema: (await import("./contracts.js")).jsonSchemas.investigationPlan,
        output: InvestigationPlanSchema,
        system: SYSTEM.planner,
        user: dataBlock("PLAN_FACTS", facts),
        actorId: run.requestedBy,
        maxCompletionTokens: 400,
      });
      await this.repo.saveInvestigationPlan(run.id, investigationPlan);
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Investigation Planner",
        stage: "select_skills",
        status: "completed",
        detail: investigationPlan.summary,
        metadata: { angles: investigationPlan.angles, queries: investigationPlan.researchQueries },
      });

      // Compound Mini's free-tier backing model has an 8K TPM quota. A pair of concurrent
      // searches can reserve more than that together, so these independent branches are
      // deliberately staged. They remain independent; only provider scheduling is serialized.
      const evidenceA = await retrieveEvidence({
        client: this.groq, facts, branch: "A", actorId: run.requestedBy, plannedQuery: investigationPlan.researchQueries.A,
      });
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Research Skill A",
        stage: "retrieve_and_check_sources",
        status: "completed",
        detail: `Retrieved and retained ${evidenceA.length} HTTPS evidence records for the first independent research angle.`,
        metadata: { branch: "A", retained: evidenceA.length },
      });
      await pause(this.config.NODE_ENV === "test" ? 0 : GROQ_EVIDENCE_COOLDOWN_MS);
      const evidenceB = await retrieveEvidence({
        client: this.groq, facts, branch: "B", actorId: run.requestedBy, plannedQuery: investigationPlan.researchQueries.B,
      });
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Research Skill B",
        stage: "retrieve_and_check_sources",
        status: "completed",
        detail: `Retrieved and retained ${evidenceB.length} HTTPS evidence records for the second independent research angle.`,
        metadata: { branch: "B", retained: evidenceB.length },
      });
      if (evidenceA.length < 2 || evidenceB.length < 2) {
        throw new AppError(502, "EVIDENCE_INSUFFICIENT", "Enough verifiable evidence could not be retrieved for independent analysis");
      }
      const sources = deDuplicateAcrossBranches(evidenceA, evidenceB);
      for (const source of sources.stored) EvidenceSourceSchema.parse(source);
      await this.repo.saveEvidence(run.id, sources.stored);
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Research Skill",
        stage: "retrieve_and_check_sources",
        status: "completed",
        detail: `Retrieved and retained ${sources.stored.length} HTTPS evidence records across two independent branches.`,
        metadata: { branchA: evidenceA.length, branchB: evidenceB.length },
      });

      const [scenarioA, scenarioB] = await Promise.all([
        this.createScenario(run.plan, facts, sources.left, "A", run.requestedBy),
        this.createScenario(run.plan, facts, sources.right, "B", run.requestedBy),
      ]);
      let semantic: Pick<Comparison, "semanticRelation" | "explanation">;
      let usedComparatorFallback = false;
      try {
        semantic = await this.groq.strictJson({
          name: "scenario_comparison",
          schema: (await import("./contracts.js")).jsonSchemas.comparator,
          output: ComparatorSchema,
          system: SYSTEM.comparator,
          user: [dataBlock("SCENARIO_A", scenarioA), dataBlock("SCENARIO_B", scenarioB)].join("\n"),
          actorId: run.requestedBy,
          maxCompletionTokens: 300,
        });
      } catch (error) {
        if (!(error instanceof UpstreamError)) throw error;
        semantic = fallbackComparison(scenarioA, scenarioB);
        usedComparatorFallback = true;
      }
      const comparison = classifyComparison(scenarioA, scenarioB, semantic);

      await this.repo.recordTrace({
        runId: run.id,
        skill: "Independent Scenario Agents",
        stage: "form_failure_hypotheses",
        status: "completed",
        detail: "Produced two independent, evidence-limited failure narratives before synthesis.",
      });
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Comparator",
        stage: "compare_branches",
        status: usedComparatorFallback || comparison.displayStatus === "meaningful_disagreement" ? "attention" : "completed",
        detail: usedComparatorFallback ? `Provider comparison output was invalid; a transparent rule-based comparison was used. ${comparison.explanation}` : comparison.explanation,
        metadata: { relation: comparison.semanticRelation, evidenceOverlap: comparison.evidenceOverlap, fallback: usedComparatorFallback },
      });

      const allowedEvidence = sources.stored.filter((source) => source.status === "retrieved" && source.sourceTier < 4);
      let critic: CriticFinding;
      let usedCriticFallback = false;
      try {
        critic = await this.groq.strictJson({
          name: "evidence_critic",
          schema: (await import("./contracts.js")).jsonSchemas.critic,
          output: CriticSchema,
          system: SYSTEM.critic,
          user: [
            dataBlock("PLAN_FACTS", facts),
            dataBlock("INVESTIGATION_PLAN", investigationPlan),
            dataBlock("SCENARIO_A", scenarioA),
            dataBlock("SCENARIO_B", scenarioB),
            dataBlock("COMPARISON", comparison),
            dataBlock("ALLOWED_EVIDENCE", evidenceCards(allowedEvidence)),
          ].join("\n"),
          actorId: run.requestedBy,
          maxCompletionTokens: 350,
        });
      } catch (error) {
        if (!(error instanceof UpstreamError)) throw error;
        critic = fallbackCritic({ plan: investigationPlan, comparison, evidence: allowedEvidence });
        usedCriticFallback = true;
      }
      await this.repo.saveCritic(run.id, critic);
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Evidence Critic",
        stage: "challenge_evidence",
        status: usedCriticFallback || critic.evidenceGaps.length ? "attention" : "completed",
        detail: usedCriticFallback ? `Provider critic output was invalid; a transparent evidence check was used. ${critic.finding}` : critic.finding,
        metadata: { evidenceGaps: critic.evidenceGaps, nextCheck: critic.nextCheck, fallback: usedCriticFallback },
      });
      let synthesis: Synthesis;
      let usedSynthesisFallback = false;
      try {
        synthesis = await this.groq.strictJson({
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
          maxCompletionTokens: 700,
        });
      } catch (error) {
        if (!(error instanceof UpstreamError)) throw error;
        synthesis = fallbackSynthesis(scenarioA, scenarioB, comparison);
        usedSynthesisFallback = true;
      }
      for (const risk of synthesis.risks) assertEvidenceReferences(risk.evidenceIds, allowedEvidence);
      await this.repo.completeRun({ runId: run.id, facts, scenarioA, scenarioB, comparison, synthesis });
      await this.repo.recordTrace({
        runId: run.id,
        skill: "Decision Skill",
        stage: "rank_risks",
        status: usedSynthesisFallback ? "attention" : "completed",
        detail: `${usedSynthesisFallback ? "Provider synthesis output was invalid; a transparent evidence-preserving synthesis was used. " : ""}Created ${synthesis.risks.length} evidence-linked risks and ranked them for human review.`,
      });
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
      maxCompletionTokens: 900,
    });
    for (const claim of scenario.claims) assertEvidenceReferences(claim.evidenceIds, evidence);
    return scenario;
  }

  async assessMitigation(args: { riskId: string; actor: { sub: string; org_id: string; role: "member" | "admin" }; answer: string }) {
    const risk = await this.repo.getRiskForActor(args.riskId, args.actor);
    let assessment: { evidence: "verified" | "partial" | "unverified" | "absent"; rationale: string; gaps: string[] };
    let usedControlFallback = false;
    try {
      assessment = await this.groq.strictJson({
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
        maxCompletionTokens: 350,
      });
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      assessment = fallbackControlAssessment(args.answer);
      usedControlFallback = true;
    }
    const scoring = rescoreSeverity(risk.severity, assessment.evidence);
    await this.repo.saveMitigation({
      riskId: risk.id, actor: args.actor, answer: args.answer, evidence: assessment.evidence,
      rationale: assessment.rationale, gaps: assessment.gaps, before: scoring.before, after: scoring.after,
    });
    await this.repo.recordTrace({
      runId: risk.analysisRunId,
      skill: "Human Challenge",
      stage: "assess_mitigation",
      status: assessment.evidence === "verified" && !usedControlFallback ? "completed" : "attention",
      detail: usedControlFallback ? `Provider control assessment was invalid; a conservative human-evidence check was used. ${assessment.rationale}` : assessment.rationale,
      metadata: { evidence: assessment.evidence, before: scoring.before, after: scoring.after, gaps: assessment.gaps, fallback: usedControlFallback },
    });
    return { assessment, ...scoring };
  }
}

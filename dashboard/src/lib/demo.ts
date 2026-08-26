import type { Analysis } from "./contracts";

export const samplePlan = `Ship the partner API integration in two weeks. The team will add OAuth client registration, signed webhooks, and a deployment path through the external gateway. The gateway team owns the final configuration and end-to-end validation is planned for the final two days. A rollback path exists but has not yet been rehearsed.`;

export const demoAnalysis: Analysis = {
  id: "f0be5034-bbc2-4e6c-81f0-9ffdcd1bc14d", status: "succeeded", createdAt: "2026-08-26T09:00:00.000Z", completedAt: "2026-08-26T09:00:12.000Z",
  normalizedPlan: { outcome: "Ship the partner API integration", timeline: "two weeks", team: "Product, platform, and gateway teams" },
  sources: [
    { id: "10904b9a-d1ec-4a56-af8e-d2ad19a04b2e", branch: "A", url: "https://sre.google/workbook/incident-response/", hostname: "sre.google", title: "Incident response and dependency controls", publisher: "Google SRE", snippet: "Incidents require clear ownership, tested response paths, and a deliberate escalation model.", providerRank: 0.93, sourceTier: 1, status: "retrieved", retrievedAt: "2026-08-26T09:00:03.000Z" },
    { id: "48eb8ea1-3df3-4467-92c9-fc184c7bddd6", branch: "A", url: "https://github.blog/engineering/", hostname: "github.blog", title: "Engineering lessons from operating production systems", publisher: "GitHub Engineering", snippet: "Reliable delivery benefits from reducing late integration uncertainty and surfacing ownership gaps early.", providerRank: 0.84, sourceTier: 2, status: "retrieved", retrievedAt: "2026-08-26T09:00:04.000Z" },
    { id: "dbf470cb-4d22-4fef-86b3-ee8004b6797d", branch: "B", url: "https://aws.amazon.com/builders-library/", hostname: "aws.amazon.com", title: "Operational readiness and rollback practice", publisher: "AWS Builders' Library", snippet: "Operational readiness requires proactive failure-mode thinking, monitoring, and tested recovery controls.", providerRank: 0.89, sourceTier: 1, status: "retrieved", retrievedAt: "2026-08-26T09:00:04.000Z" },
    { id: "32fd0ae6-7c31-4b7e-b563-bf823bbbcfb0", branch: "B", url: "https://blog.cloudflare.com/", hostname: "blog.cloudflare.com", title: "Dependency and edge-path reliability lessons", publisher: "Cloudflare", snippet: "Production systems benefit from staging validation, explicit dependency boundaries, and prepared rollback paths.", providerRank: 0.79, sourceTier: 2, status: "retrieved", retrievedAt: "2026-08-26T09:00:05.000Z" },
  ],
  branches: [
    { branch: "A", primaryCategory: "scope_control", rootCause: "The delivery promise compresses external dependency validation into the final two days.", scenario: { narrative: "The gateway configuration arrives late, leaving the team to reconcile OAuth behavior and webhook contracts under release pressure. The sprint finishes with partial integration coverage and no time to re-sequence the release safely.", claims: [{ category: "scope_control", statement: "Late validation converts a known external dependency into schedule risk.", evidenceIds: ["10904b9a-d1ec-4a56-af8e-d2ad19a04b2e", "48eb8ea1-3df3-4467-92c9-fc184c7bddd6"], impact: 4, likelihood: 4, uncertainty: "moderate" }] } },
    { branch: "B", primaryCategory: "architecture_reliability", rootCause: "The deployment path lacks a rehearsed recovery control for a cross-system integration.", scenario: { narrative: "A signed webhook failure appears after release and no exercised rollback sequence exists. The team must diagnose a distributed failure while customer-facing behavior is uncertain, increasing the chance of a prolonged partial outage.", claims: [{ category: "architecture_reliability", statement: "An untested rollback path changes a normal integration defect into an operational incident.", evidenceIds: ["dbf470cb-4d22-4fef-86b3-ee8004b6797d", "32fd0ae6-7c31-4b7e-b563-bf823bbbcfb0"], impact: 5, likelihood: 3, uncertainty: "high" }] } },
  ],
  disagreement: { categoryRelation: "different", semanticRelation: "contradicts", evidenceOverlap: 0, displayStatus: "meaningful_disagreement", explanation: "The branches agree that late validation is dangerous, but disagree about the primary failure mechanism: schedule compression versus an unprepared recovery path." },
  investigationPlan: {
    summary: "Inspect the release schedule and gateway dependency independently before deciding whether delivery or recovery readiness is the more dangerous failure path.",
    angles: [
      { category: "scope_control", branch: "A", reason: "Validation is deferred until the final two days of a short delivery window." },
      { category: "architecture_reliability", branch: "B", reason: "The cross-system rollback exists but has not been rehearsed." },
    ],
    researchQueries: {
      A: "partner API integration engineering postmortem late validation delivery capacity",
      B: "signed webhook rollback rehearsal external gateway engineering postmortem",
    },
  },
  critic: {
    finding: "Both branches rely on strong general operating guidance, but neither proves the partner gateway’s actual change lead time.",
    evidenceGaps: ["The gateway configuration lead time is not documented in the plan."],
    nextCheck: "Ask the gateway owner for a dated configuration commitment and a staging acceptance window.",
  },
  trace: [
    { skill: "PreMortem Main Agent", stage: "normalize_plan", status: "completed", detail: "Extracted the project outcome, timeline, team, dependencies, technical changes, and missing controls.", metadata: {}, createdAt: "2026-08-26T09:00:01.000Z" },
    { skill: "Investigation Planner", stage: "select_skills", status: "completed", detail: "Selected separate delivery-risk and recovery-readiness branches for this project.", metadata: {}, createdAt: "2026-08-26T09:00:02.000Z" },
    { skill: "Research Skill", stage: "retrieve_and_check_sources", status: "completed", detail: "Retrieved and retained four HTTPS evidence records across two branches.", metadata: {}, createdAt: "2026-08-26T09:00:05.000Z" },
    { skill: "Independent Scenario Agents", stage: "form_failure_hypotheses", status: "completed", detail: "Produced two independent, evidence-limited failure narratives before synthesis.", metadata: {}, createdAt: "2026-08-26T09:00:07.000Z" },
    { skill: "Comparator", stage: "compare_branches", status: "attention", detail: "The branches disagree about the primary failure mechanism.", metadata: {}, createdAt: "2026-08-26T09:00:08.000Z" },
    { skill: "Evidence Critic", stage: "challenge_evidence", status: "attention", detail: "The partner gateway’s actual configuration lead time has not been proven.", metadata: {}, createdAt: "2026-08-26T09:00:09.000Z" },
    { skill: "Decision Skill", stage: "rank_risks", status: "completed", detail: "Created and ranked three evidence-linked risks for human review.", metadata: {}, createdAt: "2026-08-26T09:00:12.000Z" },
  ],
  actions: [],
  risks: [
    { id: "2183523b-9857-48f6-aefd-6405233381a7", category: "scope_control", title: "Critical validation is deferred", explanation: "The external gateway is essential to the release but full validation is planned after the remaining schedule buffer is gone.", evidenceIds: ["10904b9a-d1ec-4a56-af8e-d2ad19a04b2e", "48eb8ea1-3df3-4467-92c9-fc184c7bddd6"], impact: 4, likelihood: 4, severity: 4, mitigation: "Move a gateway configuration and signed-webhook canary into the first milestone, with a named gateway owner.", uncertainty: "moderate" },
    { id: "8b0f976b-0ce0-4b63-aa42-eb35e31f7fca", category: "external_dependency", title: "Gateway ownership is incomplete", explanation: "The plan names an external owner but does not define an escalation path, acceptance condition, or fallback when the configuration slips.", evidenceIds: ["10904b9a-d1ec-4a56-af8e-d2ad19a04b2e"], impact: 4, likelihood: 3, severity: 4, mitigation: "Record the owner, an integration acceptance test, escalation SLA, and a release fallback by day three.", uncertainty: "moderate" },
    { id: "67f0e7ee-31c4-49d7-9c1d-f3df10e80cb9", category: "architecture_reliability", title: "Rollback is untested", explanation: "The team has identified a rollback path but has not shown that it works across the gateway and webhook boundary.", evidenceIds: ["dbf470cb-4d22-4fef-86b3-ee8004b6797d", "32fd0ae6-7c31-4b7e-b563-bf823bbbcfb0"], impact: 5, likelihood: 3, severity: 4, mitigation: "Run a staging rollback drill with observable success criteria before opening the partner traffic path.", uncertainty: "high" },
  ],
};

import { z } from "zod";

export const CreateAnalysisInput = z.object({
  projectId: z.string().uuid(),
  plan: z.string().trim().min(80).max(12_000),
  idempotencyKey: z.string().uuid(),
}).strict();

export const MitigationInput = z.object({
  answer: z.string().trim().min(8).max(4_000),
}).strict();

const Email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const Password = z.string().min(12).max(200)
  .refine((value) => /[a-z]/i.test(value) && /\d/.test(value), "Password must include letters and numbers");

export const RegisterInput = z.object({
  organizationName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(120),
  email: Email,
  password: Password,
}).strict();

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1).max(200),
}).strict();

export const CreateProjectInput = z.object({
  name: z.string().trim().min(2).max(160),
  retentionPolicy: z.enum(["standard", "restricted"]).default("standard"),
}).strict();

export const UpdateProjectInput = z.object({
  name: z.string().trim().min(2).max(160),
}).strict();

export const RiskCategory = z.enum([
  "scope_control",
  "requirements_quality",
  "delivery_capacity",
  "external_dependency",
  "architecture_reliability",
  "operational_readiness",
  "security_compliance",
]);

export const Uncertainty = z.enum(["low", "moderate", "high"]);
export const ControlEvidence = z.enum(["verified", "partial", "unverified", "absent"]);

export const InvestigationPlanSchema = z.object({
  summary: z.string().min(20).max(400),
  angles: z.array(z.object({
    category: RiskCategory,
    branch: z.enum(["A", "B"]),
    reason: z.string().min(12).max(280),
  }).strict()).min(2).max(4),
  researchQueries: z.object({
    A: z.string().min(12).max(900),
    B: z.string().min(12).max(900),
  }).strict(),
}).strict();

export const CriticSchema = z.object({
  finding: z.string().min(20).max(400),
  evidenceGaps: z.array(z.string().min(8).max(240)).max(4),
  nextCheck: z.string().min(12).max(280),
}).strict();

export const MockActionInput = z.object({
  owner: z.string().trim().min(2).max(120),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must use YYYY-MM-DD"),
  approvalNote: z.string().trim().min(8).max(800),
}).strict();

export const VerificationInput = z.object({
  outcome: z.enum(["verified", "failed"]),
  note: z.string().trim().min(8).max(1_200),
}).strict();

export const PlanFactsSchema = z.object({
  outcome: z.string().min(8).max(400),
  timeline: z.string().min(2).max(150),
  team: z.string().min(2).max(250),
  dependencies: z.array(z.string().min(2).max(250)).max(12),
  technicalChanges: z.array(z.string().min(2).max(250)).max(12),
  missingControls: z.array(z.string().min(2).max(250)).max(12),
}).strict();

export const EvidenceSourceSchema = z.object({
  id: z.string().uuid(),
  branch: z.enum(["A", "B"]),
  url: z.url().refine((value) => new URL(value).protocol === "https:", "Evidence URLs must use HTTPS"),
  hostname: z.string().min(1).max(255),
  title: z.string().min(3).max(300),
  publisher: z.string().min(1).max(300).nullable(),
  snippet: z.string().min(20).max(1_500),
  providerRank: z.number().finite().nullable(),
  sourceTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  status: z.enum(["retrieved", "rejected", "unresolved"]),
  rejectionReason: z.string().max(300).optional(),
  retrievedAt: z.string().datetime(),
}).strict();

export const ClaimSchema = z.object({
  category: RiskCategory,
  statement: z.string().min(12).max(320),
  evidenceIds: z.array(z.string().uuid()).min(1).max(3),
  impact: z.number().int().min(1).max(5),
  likelihood: z.number().int().min(1).max(5),
  uncertainty: Uncertainty,
}).strict();

export const ScenarioSchema = z.object({
  primaryCategory: RiskCategory,
  contributingCategories: z.array(RiskCategory).max(2),
  rootCause: z.string().min(8).max(180),
  narrative: z.string().min(120).max(1_200),
  claims: z.array(ClaimSchema).min(1).max(4),
}).strict();

export const SemanticRelation = z.enum(["corroborates", "complements", "contradicts", "unresolved"]);

export const ComparatorSchema = z.object({
  semanticRelation: SemanticRelation,
  explanation: z.string().min(20).max(400),
}).strict();

export const SynthesisSchema = z.object({
  risks: z.array(z.object({
    category: RiskCategory,
    title: z.string().min(8).max(120),
    explanation: z.string().min(20).max(500),
    evidenceIds: z.array(z.string().uuid()).min(1).max(4),
    impact: z.number().int().min(1).max(5),
    likelihood: z.number().int().min(1).max(5),
    mitigation: z.string().min(20).max(400),
    uncertainty: Uncertainty,
  }).strict()).min(3).max(6),
}).strict();

export const ControlAssessmentSchema = z.object({
  evidence: ControlEvidence,
  rationale: z.string().min(20).max(400),
  gaps: z.array(z.string().min(4).max(180)).max(5),
}).strict();

export type PlanFacts = z.infer<typeof PlanFactsSchema>;
export type InvestigationPlan = z.infer<typeof InvestigationPlanSchema>;
export type CriticFinding = z.infer<typeof CriticSchema>;
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Synthesis = z.infer<typeof SynthesisSchema>;
export type Comparison = z.infer<typeof ComparatorSchema> & {
  categoryRelation: "same" | "related" | "different";
  evidenceOverlap: number;
  displayStatus: "corroborated" | "meaningful_disagreement" | "insufficient_evidence";
};

export const jsonSchemas = {
  investigationPlan: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      angles: { type: "array", items: {
        type: "object", additionalProperties: false,
        properties: {
          category: { type: "string", enum: RiskCategory.options }, branch: { type: "string", enum: ["A", "B"] }, reason: { type: "string" },
        }, required: ["category", "branch", "reason"],
      } },
      researchQueries: { type: "object", additionalProperties: false, properties: { A: { type: "string" }, B: { type: "string" } }, required: ["A", "B"] },
    }, required: ["summary", "angles", "researchQueries"],
  },
  planFacts: {
    type: "object", additionalProperties: false,
    properties: {
      outcome: { type: "string" }, timeline: { type: "string" }, team: { type: "string" },
      dependencies: { type: "array", items: { type: "string" } },
      technicalChanges: { type: "array", items: { type: "string" } },
      missingControls: { type: "array", items: { type: "string" } },
    },
    required: ["outcome", "timeline", "team", "dependencies", "technicalChanges", "missingControls"],
  },
  scenario: {
    type: "object", additionalProperties: false,
    properties: {
      primaryCategory: { type: "string", enum: RiskCategory.options },
      contributingCategories: { type: "array", items: { type: "string", enum: RiskCategory.options } },
      rootCause: { type: "string" }, narrative: { type: "string" },
      claims: { type: "array", items: {
        type: "object", additionalProperties: false,
        properties: {
          category: { type: "string", enum: RiskCategory.options }, statement: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } }, impact: { type: "integer" },
          likelihood: { type: "integer" }, uncertainty: { type: "string", enum: Uncertainty.options },
        }, required: ["category", "statement", "evidenceIds", "impact", "likelihood", "uncertainty"],
      } },
    }, required: ["primaryCategory", "contributingCategories", "rootCause", "narrative", "claims"],
  },
  comparator: {
    type: "object", additionalProperties: false,
    properties: {
      semanticRelation: { type: "string", enum: SemanticRelation.options }, explanation: { type: "string" },
    }, required: ["semanticRelation", "explanation"],
  },
  synthesis: {
    type: "object", additionalProperties: false,
    properties: { risks: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        category: { type: "string", enum: RiskCategory.options }, title: { type: "string" },
        explanation: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } },
        impact: { type: "integer" }, likelihood: { type: "integer" }, mitigation: { type: "string" },
        uncertainty: { type: "string", enum: Uncertainty.options },
      }, required: ["category", "title", "explanation", "evidenceIds", "impact", "likelihood", "mitigation", "uncertainty"],
    } } }, required: ["risks"],
  },
  controlAssessment: {
    type: "object", additionalProperties: false,
    properties: {
      evidence: { type: "string", enum: ControlEvidence.options }, rationale: { type: "string" },
      gaps: { type: "array", items: { type: "string" } },
    }, required: ["evidence", "rationale", "gaps"],
  },
  critic: {
    type: "object", additionalProperties: false,
    properties: {
      finding: { type: "string" }, evidenceGaps: { type: "array", items: { type: "string" } }, nextCheck: { type: "string" },
    }, required: ["finding", "evidenceGaps", "nextCheck"],
  },
} as const;

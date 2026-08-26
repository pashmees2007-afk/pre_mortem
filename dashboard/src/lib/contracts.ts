import { z } from "zod";

export const sourceSchema = z.object({
  id: z.string().uuid(),
  branch: z.enum(["A", "B"]),
  url: z.url(),
  hostname: z.string(),
  title: z.string(),
  publisher: z.string().nullable(),
  snippet: z.string(),
  providerRank: z.number().nullable(),
  sourceTier: z.number().int().min(1).max(4),
  status: z.enum(["retrieved", "rejected", "unresolved"]),
  retrievedAt: z.string(),
});

export const branchSchema = z.object({
  branch: z.enum(["A", "B"]),
  primaryCategory: z.string(),
  rootCause: z.string(),
  scenario: z.object({
    narrative: z.string(),
    claims: z.array(z.object({
      category: z.string(), statement: z.string(), evidenceIds: z.array(z.string().uuid()),
      impact: z.number(), likelihood: z.number(), uncertainty: z.enum(["low", "moderate", "high"]),
    })),
  }),
});

export const riskSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  title: z.string(),
  explanation: z.string(),
  evidenceIds: z.array(z.string().uuid()),
  impact: z.number().int().min(1).max(5),
  likelihood: z.number().int().min(1).max(5),
  severity: z.number().int().min(1).max(5),
  mitigation: z.string(),
  uncertainty: z.enum(["low", "moderate", "high"]),
});

export const analysisSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  createdAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
  failureCode: z.string().nullable().optional(),
  normalizedPlan: z.object({ outcome: z.string(), timeline: z.string(), team: z.string() }).nullable().optional(),
  sources: z.array(sourceSchema).default([]),
  branches: z.array(branchSchema).default([]),
  risks: z.array(riskSchema).default([]),
  disagreement: z.object({
    categoryRelation: z.enum(["same", "related", "different"]),
    semanticRelation: z.enum(["corroborates", "complements", "contradicts", "unresolved"]),
    evidenceOverlap: z.number().min(0).max(1),
    displayStatus: z.enum(["corroborated", "meaningful_disagreement", "insufficient_evidence"]),
    explanation: z.string(),
  }).nullable(),
});

export type Analysis = z.infer<typeof analysisSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type MitigationResponse = {
  assessment: { evidence: "verified" | "partial" | "unverified" | "absent"; rationale: string; gaps: string[] };
  before: number; after: number; delta: number; rationale: string;
};

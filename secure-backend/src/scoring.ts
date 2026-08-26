import type { Comparison, Scenario } from "./contracts.js";

export function scoreSeverity(impact: number, likelihood: number): 1 | 2 | 3 | 4 | 5 {
  const raw = impact * likelihood;
  if (raw >= 20) return 5;
  if (raw >= 12) return 4;
  if (raw >= 6) return 3;
  if (raw >= 3) return 2;
  return 1;
}

export function rescoreSeverity(before: number, evidence: "verified" | "partial" | "unverified" | "absent") {
  const delta = evidence === "verified" ? -2 : evidence === "partial" ? -1 : 0;
  const after = Math.max(1, Math.min(5, before + delta)) as 1 | 2 | 3 | 4 | 5;
  const rationale = evidence === "verified"
    ? "A named, testable control with evidence reduces the risk by two levels."
    : evidence === "partial"
      ? "The control exists but material evidence or a fallback condition remains missing."
      : "Severity is retained until a testable control is evidenced.";
  return { before, after, delta, rationale };
}

function jaccard(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  const intersection = [...left].filter((id) => right.has(id)).length;
  return intersection / union.size;
}

export function classifyComparison(a: Scenario, b: Scenario, semantic: { semanticRelation: Comparison["semanticRelation"]; explanation: string }): Comparison {
  const categoriesA = new Set([a.primaryCategory, ...a.contributingCategories]);
  const categoriesB = new Set([b.primaryCategory, ...b.contributingCategories]);
  const categoryRelation = a.primaryCategory === b.primaryCategory
    ? "same"
    : [...categoriesA].some((category) => categoriesB.has(category)) ? "related" : "different";
  const evidenceA = a.claims.flatMap((claim) => claim.evidenceIds);
  const evidenceB = b.claims.flatMap((claim) => claim.evidenceIds);
  const evidenceOverlap = jaccard(evidenceA, evidenceB);
  const independentlySupported = new Set(evidenceA).size >= 2 && new Set(evidenceB).size >= 2 && evidenceOverlap < 0.5;
  const displayStatus = (semantic.semanticRelation === "contradicts" && independentlySupported)
    || (categoryRelation === "different" && independentlySupported)
    ? "meaningful_disagreement"
    : semantic.semanticRelation === "corroborates" && evidenceOverlap < 0.8
      ? "corroborated"
      : "insufficient_evidence";
  return { ...semantic, categoryRelation, evidenceOverlap, displayStatus };
}

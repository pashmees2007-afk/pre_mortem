import type { Analysis } from "./contracts";

export function matrixStatus(analysis: Analysis) {
  const status = analysis.disagreement?.displayStatus;
  if (status === "meaningful_disagreement") return { label: "Meaningful disagreement", tone: "signal" as const, description: "The branches have independent support for different primary failure mechanisms." };
  if (status === "corroborated") return { label: "Corroborated", tone: "teal" as const, description: "Independent branches converge on a supported risk mechanism." };
  return { label: "Insufficient evidence", tone: "stone" as const, description: "The current branch outputs do not support a confident comparative conclusion." };
}

export function evidenceCoverage(analysis: Analysis, riskId: string) {
  const risk = analysis.risks.find((item) => item.id === riskId);
  if (!risk) return 0;
  return new Set(risk.evidenceIds).size;
}

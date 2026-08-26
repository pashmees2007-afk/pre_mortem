import { describe, expect, it } from "vitest";
import { analysisSchema } from "./contracts";
import { demoAnalysis } from "./demo";

describe("dashboard analysis contract", () => {
  it("keeps every displayed risk linked to a retained evidence source", () => {
    const knownSources = new Set(demoAnalysis.sources.map((source) => source.id));
    for (const risk of demoAnalysis.risks) {
      expect(risk.evidenceIds.length).toBeGreaterThan(0);
      expect(risk.evidenceIds.every((id) => knownSources.has(id))).toBe(true);
    }
  });

  it("rejects malformed backend analysis data before it reaches the dashboard", () => {
    const malformed = structuredClone(demoAnalysis) as { risks: Array<{ severity: number }> };
    malformed.risks[0]!.severity = 8;
    expect(() => analysisSchema.parse(malformed)).toThrow();
  });
});

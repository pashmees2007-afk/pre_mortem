import { describe, expect, it } from "vitest";
import type { Scenario } from "./contracts.js";
import { fallbackComparison } from "./engine.js";

const scenario = (primaryCategory: string) => ({ primaryCategory }) as unknown as Scenario;

describe("rule-based branch comparison", () => {
  it("names a shared category once, in words rather than as an identifier", () => {
    const result = fallbackComparison(scenario("operational_readiness"), scenario("operational_readiness"));
    expect(result.semanticRelation).toBe("corroborates");
    expect(result.explanation).toContain("Both branches focus on operational readiness");
    expect(result.explanation).not.toContain("_");
  });

  it("names each branch's category in words when they differ", () => {
    const result = fallbackComparison(scenario("delivery_capacity"), scenario("architecture_reliability"));
    expect(result.semanticRelation).toBe("complements");
    expect(result.explanation).toContain("Branch A focuses on delivery capacity, while Branch B focuses on architecture reliability");
  });
});

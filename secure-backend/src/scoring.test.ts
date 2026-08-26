import { describe, expect, it } from "vitest";
import type { Scenario } from "./contracts.js";
import { classifyComparison, rescoreSeverity, scoreSeverity } from "./scoring.js";

const sourceA = "11111111-1111-4111-8111-111111111111";
const sourceB = "22222222-2222-4222-8222-222222222222";
const sourceC = "33333333-3333-4333-8333-333333333333";
const sourceD = "44444444-4444-4444-8444-444444444444";

function scenario(primaryCategory: Scenario["primaryCategory"], ids: string[]): Scenario {
  return {
    primaryCategory, contributingCategories: [], rootCause: "A bounded root cause statement", narrative: "A future failure scenario with enough detail to satisfy the structured contract and preserve the causal chain for decision support.",
    claims: [{ category: primaryCategory, statement: "A source-grounded claim that has enough detail.", evidenceIds: ids, impact: 4, likelihood: 4, uncertainty: "moderate" }],
  };
}

describe("severity scoring", () => {
  it("maps impact and likelihood to a stable five-level rubric", () => {
    expect(scoreSeverity(5, 5)).toBe(5);
    expect(scoreSeverity(3, 4)).toBe(4);
    expect(scoreSeverity(2, 3)).toBe(3);
    expect(scoreSeverity(1, 3)).toBe(2);
  });

  it("preserves the auditable original score when mitigation evidence is absent", () => {
    expect(rescoreSeverity(4, "absent")).toMatchObject({ before: 4, after: 4, delta: 0 });
  });

  it("only lowers severity for partial or verified control evidence", () => {
    expect(rescoreSeverity(5, "partial")).toMatchObject({ before: 5, after: 4, delta: -1 });
    expect(rescoreSeverity(5, "verified")).toMatchObject({ before: 5, after: 3, delta: -2 });
  });
});

describe("branch comparison", () => {
  it("requires independent evidence before flagging meaningful disagreement", () => {
    const result = classifyComparison(
      scenario("scope_control", [sourceA, sourceB]),
      scenario("architecture_reliability", [sourceC, sourceD]),
      { semanticRelation: "contradicts", explanation: "The branches identify incompatible primary failure mechanisms." },
    );
    expect(result.displayStatus).toBe("meaningful_disagreement");
    expect(result.evidenceOverlap).toBe(0);
  });

  it("does not call superficial category divergence disagreement without independent support", () => {
    const result = classifyComparison(
      scenario("scope_control", [sourceA]),
      scenario("architecture_reliability", [sourceB]),
      { semanticRelation: "contradicts", explanation: "The branches identify different categories but not enough evidence." },
    );
    expect(result.displayStatus).toBe("insufficient_evidence");
  });
});

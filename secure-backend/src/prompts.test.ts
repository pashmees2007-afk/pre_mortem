import { describe, expect, it } from "vitest";
import { SYSTEM } from "./prompts.js";

describe("stated mitigation prompts", () => {
  it("keeps schedules, constraints and targets out of stated mitigations", () => {
    expect(SYSTEM.normalize).toContain("a success-metric target");
    expect(SYSTEM.normalize).toContain("is never a mitigation");
    expect(SYSTEM.normalize).not.toMatch(/mitigation, threshold, target or fallback/);
  });

  it("keeps a risk the plan mitigates out of missing controls", () => {
    expect(SYSTEM.normalize).toContain("A risk the plan names with a mitigation never goes in missingControls");
    expect(SYSTEM.normalize).toContain('"risk: mitigation"');
  });

  it("lets the planner investigate a stated target the plan cannot validate", () => {
    expect(SYSTEM.planner).toContain("PLAN_FACTS.statedMitigations");
    expect(SYSTEM.planner).toContain("can still be a risk angle");
  });

  it("asks the synthesis for a recommended action, not an unrelated stated mitigation", () => {
    expect(SYSTEM.synthesis).toContain("recommended next action");
    expect(SYSTEM.synthesis).toContain("never quote a stated mitigation written for a different risk");
  });
});

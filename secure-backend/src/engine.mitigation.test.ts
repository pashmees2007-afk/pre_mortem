import { describe, expect, it, vi } from "vitest";
import type { Config } from "./config.js";
import { PreMortemEngine } from "./engine.js";
import { UpstreamError } from "./errors.js";
import type { GroqClient } from "./groq.js";
import type { Repository } from "./repository.js";

const actor = { sub: "user", org_id: "org", role: "admin" as const };
const risk = { id: "risk", analysisRunId: "run", title: "Unrehearsed rollback", mitigation: "Rehearse rollback", severity: 5 };

function engineFailingWith(error: Error) {
  const repo = { getRiskForActor: vi.fn().mockResolvedValue(risk), saveMitigation: vi.fn(), recordTrace: vi.fn() };
  const groq = { strictJson: vi.fn().mockRejectedValue(error) };
  return { repo, engine: new PreMortemEngine(repo as unknown as Repository, groq as unknown as GroqClient, {} as Config) };
}

describe("mitigation assessment fallback", () => {
  it("says the provider was rate-limited, not that its output was invalid, and asks for plan-neutral evidence", async () => {
    const { repo, engine } = engineFailingWith(new UpstreamError("Rate limit reached on output tokens per minute (OTPM).", 429));
    const result = await engine.assessMitigation({ riskId: "risk", actor, answer: "We will be careful during the cutover." });

    expect(result.assessment.evidence).toBe("unverified");
    expect(result.assessment.rationale).toContain("rate-limited");
    expect(result.assessment.rationale).not.toContain("invalid");
    expect(result.assessment.gaps.join(" ")).not.toMatch(/payment|webhook/);
    expect(result.assessment.gaps).toContain("Provide repeatable test evidence.");
    expect(repo.recordTrace).toHaveBeenCalledWith(expect.objectContaining({
      status: "attention",
      metadata: expect.objectContaining({ fallback: true, fallbackCause: "rate_limited" }),
    }));
  });

  it("still reports invalid provider output as invalid", async () => {
    const { repo, engine } = engineFailingWith(new UpstreamError("control_assessment: the analysis provider returned an invalid result shape for evidence"));
    const result = await engine.assessMitigation({ riskId: "risk", actor, answer: "The SRE lead owns the rollback, with alerts on queue depth." });

    expect(result.assessment.rationale).toContain("invalid");
    expect(result.assessment.gaps).toEqual(["Provide repeatable test evidence."]);
    expect(repo.recordTrace).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ fallbackCause: "invalid_output" }) }));
  });
});

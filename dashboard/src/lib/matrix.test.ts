import { describe, expect, it } from "vitest";
import { demoAnalysis } from "./demo";
import { matrixStatus } from "./matrix";

describe("matrix status", () => {
  it("preserves meaningful disagreement instead of flattening distinct branch mechanisms", () => {
    expect(matrixStatus(demoAnalysis)).toMatchObject({ label: "Meaningful disagreement", tone: "signal" });
  });

  it("shows insufficient evidence when no comparative record is available", () => {
    expect(matrixStatus({ ...demoAnalysis, disagreement: null })).toMatchObject({ label: "Insufficient evidence", tone: "stone" });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PlanFacts } from "./contracts.js";
import { retrieveEvidence } from "./evidence.js";
import type { GroqClient } from "./groq.js";

const facts: PlanFacts = {
  outcome: "Migrate a production service to Kubernetes",
  timeline: "three weeks",
  team: "SRE",
  dependencies: ["DNS approval"],
  technicalChanges: ["Containerise the service"],
  missingControls: ["Rehearsed rollback"],
};

function toolResponse(results: Array<{ url: string; title: string; content: string }>) {
  return { choices: [{ message: { executed_tools: [{ search_results: results }] } }] };
}

describe("trusted evidence retrieval", () => {
  it("prioritises Tier-1 engineering domains and stops when two trusted sources are retained", async () => {
    const webSearch = vi.fn().mockResolvedValue(toolResponse([
      { url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/", title: "Deployments", content: "Kubernetes Deployments support controlled rollout and rollback of workloads." },
      { url: "https://sre.google/sre-book/service-best-practices/", title: "Production Services Best Practices", content: "Progressive rollouts and supervised rollback reduce production change risk." },
    ]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts, branch: "A", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceTier === 1)).toBe(true);
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(webSearch.mock.calls[0]?.[0].includeDomains).toContain("kubernetes.io");
  });

  it("uses broad search only to fill remaining slots when fewer than two Tier-1 sources are available", async () => {
    const webSearch = vi.fn()
      .mockResolvedValueOnce(toolResponse([
        { url: "https://docs.stripe.com/webhooks", title: "Webhooks", content: "Webhook handlers should verify signed payloads and acknowledge delivery promptly." },
      ]))
      .mockResolvedValueOnce(toolResponse([
        { url: "https://example.com/reliable-retries", title: "Reliable retries", content: "Retries require durable idempotency and monitoring to prevent duplicate work." },
      ]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts, branch: "B", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.sourceTier)).toEqual([1, 3]);
    expect(webSearch).toHaveBeenCalledTimes(2);
    expect(webSearch.mock.calls[1]?.[0].includeDomains).toBeUndefined();
  });

  it("retries trusted guidance when the first two searches cannot supply two distinct sources", async () => {
    const repeated = { url: "https://docs.stripe.com/webhooks", title: "Webhooks", content: "Webhook handlers should verify signed payloads and acknowledge delivery promptly." };
    const webSearch = vi.fn()
      .mockResolvedValueOnce(toolResponse([repeated]))
      .mockResolvedValueOnce(toolResponse([repeated]))
      .mockResolvedValueOnce(toolResponse([
        { url: "https://sre.google/sre-book/service-best-practices/", title: "Production Services Best Practices", content: "Progressive rollout and supervised rollback reduce production change risk." },
      ]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts, branch: "B", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceTier === 1)).toBe(true);
    expect(webSearch).toHaveBeenCalledTimes(3);
    expect(webSearch.mock.calls[2]?.[0].includeDomains).toContain("sre.google");
  });

  it("uses payment-system and financial-control Tier-1 domains for a fintech plan", async () => {
    const fintechFacts: PlanFacts = {
      ...facts,
      outcome: "Launch a cross-border payments wallet",
      dependencies: ["KYC vendor", "sponsor bank"],
      technicalChanges: ["Settlement reconciliation"],
      missingControls: ["AML threshold testing"],
    };
    const webSearch = vi.fn().mockResolvedValue(toolResponse([
      { url: "https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/cross-border-payments/", title: "Cross-border Payments", content: "The Financial Stability Board coordinates international cross-border payments improvement work." },
      { url: "https://ofac.treasury.gov/media/16331/download?inline", title: "Compliance Commitments", content: "A risk-based sanctions compliance program includes risk assessment, controls, testing, and training." },
    ]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts: fintechFacts, branch: "B", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceTier === 1)).toBe(true);
    expect(webSearch.mock.calls[0]?.[0].includeDomains).toContain("fsb.org");
    expect(webSearch.mock.calls[0]?.[0].includeDomains).toContain("ofac.treasury.gov");
  });
});

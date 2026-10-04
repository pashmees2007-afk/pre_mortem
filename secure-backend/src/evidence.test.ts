import { describe, expect, it, vi } from "vitest";
import type { PlanFacts } from "./contracts.js";
import { evidenceTopicFor, retrieveEvidence, siteKey, tierOneDomainsFor } from "./evidence.js";
import type { GroqClient } from "./groq.js";

const facts: PlanFacts = {
  outcome: "Migrate a production service to Kubernetes",
  timeline: "three weeks",
  team: "SRE",
  dependencies: ["DNS approval"],
  technicalChanges: ["Containerise the service"],
  missingControls: ["Rehearsed rollback"],
};

const fintechFacts: PlanFacts = {
  ...facts,
  outcome: "Launch a cross-border payments wallet",
  dependencies: ["KYC vendor", "sponsor bank"],
  technicalChanges: ["Settlement reconciliation"],
  missingControls: ["AML threshold testing"],
};

function toolResponse(results: Array<{ url: string; title: string; content: string }>) {
  return { choices: [{ message: { executed_tools: [{ search_results: results }] } }] };
}

const kubernetes = { url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/", title: "Deployments", content: "Kubernetes Deployments support controlled rollout and rollback of workloads." };
const microsoft = { url: "https://learn.microsoft.com/en-us/azure/well-architected/reliability/", title: "Reliability design principles", content: "Design for recovery with tested rollback and failure-mode analysis." };
const sre = { url: "https://sre.google/sre-book/service-best-practices/", title: "Production Services Best Practices", content: "Progressive rollouts and supervised rollback reduce production change risk." };
const cloudflare = { url: "https://blog.cloudflare.com/details-of-the-cloudflare-outage/", title: "Outage details", content: "A configuration rollout without staged validation caused a global incident." };

describe("branch-disjoint trusted evidence", () => {
  it("splits every topic's Tier-1 set into two halves that share no publishing organisation", () => {
    for (const topic of ["engineering", "fintech"] as const) {
      const sitesA = new Set(tierOneDomainsFor(topic, "A").map(siteKey));
      const sitesB = tierOneDomainsFor(topic, "B").map(siteKey);
      expect(sitesB.filter((site) => sitesA.has(site))).toEqual([]);
    }
  });

  it("keeps each publisher on the same branch across topics, so a run can never hand one publisher to both branches", () => {
    const branchOf = new Map<string, string>();
    for (const topic of ["engineering", "fintech"] as const) {
      for (const branch of ["A", "B"] as const) {
        for (const site of tierOneDomainsFor(topic, branch).map(siteKey)) {
          expect(branchOf.get(site) ?? branch).toBe(branch);
          branchOf.set(site, branch);
        }
      }
    }
  });

  it("reduces hostnames to their organisation-level site", () => {
    expect(siteKey("docs.aws.amazon.com")).toBe("amazon.com");
    expect(siteKey("www.fca.org.uk")).toBe("fca.org.uk");
    expect(siteKey("bankofengland.co.uk")).toBe("bankofengland.co.uk");
    expect(siteKey("ofac.treasury.gov")).toBe("treasury.gov");
    expect(siteKey("sre.google")).toBe("sre.google");
  });

  it("chooses one topic per run from the plan and both branch queries", () => {
    expect(evidenceTopicFor(facts, ["rollback readiness", "delivery capacity"])).toBe("engineering");
    expect(evidenceTopicFor(facts, ["rollback readiness", "card payment settlement failures"])).toBe("fintech");
    expect(evidenceTopicFor(fintechFacts)).toBe("fintech");
  });

  it("drops the other branch's reserved publishers even when the same search result list contains them", async () => {
    const webSearch = vi.fn().mockResolvedValue(toolResponse([kubernetes, sre, microsoft, cloudflare]));
    const client = { webSearch } as unknown as GroqClient;

    const sourcesA = await retrieveEvidence({ client, facts, branch: "A", actorId: "actor", topic: "engineering" });
    const sourcesB = await retrieveEvidence({ client, facts, branch: "B", actorId: "actor", topic: "engineering", excludeHostnames: sourcesA.map((source) => source.hostname) });

    expect(sourcesA.map((source) => source.hostname)).toEqual(["kubernetes.io", "learn.microsoft.com"]);
    expect(sourcesB.map((source) => source.hostname)).toEqual(["sre.google", "blog.cloudflare.com"]);
  });

  it("excludes a non-Tier-1 site the other branch already used, even from the unrestricted broad search", async () => {
    const shared = { url: "https://example.com/reliable-retries", title: "Reliable retries", content: "Retries require durable idempotency and monitoring to prevent duplicate work." };
    const other = { url: "https://engineering.example.org/postmortem", title: "Queue migration postmortem", content: "Draining in-flight jobs before cutover prevented duplicate sends." };
    const webSearch = vi.fn()
      .mockResolvedValueOnce(toolResponse([sre]))
      .mockResolvedValueOnce(toolResponse([{ ...shared, url: "https://www.example.com/another-page" }, other]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts, branch: "B", actorId: "actor", topic: "engineering", excludeHostnames: ["example.com"] });

    expect(sources.map((source) => source.hostname)).toEqual(["sre.google", "engineering.example.org"]);
  });
});

describe("trusted evidence retrieval", () => {
  it("prioritises the branch's own Tier-1 domains and stops when two trusted sources are retained", async () => {
    const webSearch = vi.fn().mockResolvedValue(toolResponse([kubernetes, microsoft]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts, branch: "A", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceTier === 1)).toBe(true);
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(webSearch.mock.calls[0]?.[0].includeDomains).toContain("kubernetes.io");
    expect(webSearch.mock.calls[0]?.[0].includeDomains).not.toContain("sre.google");
  });

  it("uses broad search only to fill remaining slots when fewer than two Tier-1 sources are available", async () => {
    const webSearch = vi.fn()
      .mockResolvedValueOnce(toolResponse([sre]))
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
    const webSearch = vi.fn()
      .mockResolvedValueOnce(toolResponse([sre]))
      .mockResolvedValueOnce(toolResponse([sre]))
      .mockResolvedValueOnce(toolResponse([cloudflare]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts, branch: "B", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceTier === 1)).toBe(true);
    expect(webSearch).toHaveBeenCalledTimes(3);
    expect(webSearch.mock.calls[2]?.[0].includeDomains).toContain("blog.cloudflare.com");
  });

  it("gives each branch its own half of the payment-system and financial-control Tier-1 domains for a fintech plan", async () => {
    const webSearch = vi.fn().mockResolvedValue(toolResponse([
      { url: "https://ofac.treasury.gov/media/16331/download?inline", title: "Compliance Commitments", content: "A risk-based sanctions compliance program includes risk assessment, controls, testing, and training." },
      { url: "https://www.fincen.gov/resources/statutes-regulations/guidance", title: "FinCEN Guidance", content: "Guidance on customer due diligence and suspicious activity reporting obligations." },
    ]));
    const client = { webSearch } as unknown as GroqClient;

    const sources = await retrieveEvidence({ client, facts: fintechFacts, branch: "B", actorId: "actor" });

    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.sourceTier === 1)).toBe(true);
    expect(webSearch.mock.calls[0]?.[0].includeDomains).toContain("ofac.treasury.gov");
    expect(webSearch.mock.calls[0]?.[0].includeDomains).not.toContain("fsb.org");
  });
});

describe("GPT-OSS browser_search evidence", () => {
  // Real response shape: a titled search hit with empty content, then a separate browser.open record.
  function browserResponse(hits: Array<{ url: string; title: string }>, opened: Array<{ url: string; host: string; lines: string[] }>) {
    return { choices: [{ message: { executed_tools: [
      { name: "browser.search", search_results: { results: hits.map((hit) => ({ ...hit, content: "", score: 0 })) } },
      ...opened.map((page) => ({ name: "browser.open", search_results: { results: [{
        url: page.url, title: `${page.host} - viewing lines [0 - 96] of 96`, score: 0,
        content: ["L0: ", "L1: URL:", `L2: ${page.url}`, ...page.lines.map((line, index) => `L${index + 3}: ${line}`)].join("\n"),
      }] } })),
    ] } }] };
  }
  const rollback = "https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/";
  const deployments = "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/";

  it("keeps opened pages, titled from the search hit, with line markers stripped from the snippet", async () => {
    const webSearch = vi.fn().mockResolvedValue(browserResponse(
      [{ url: rollback, title: "kubectl rollout undo" }, { url: deployments, title: "Deployments" }, { url: "https://learn.microsoft.com/en-us/azure/aks/", title: "AKS" }],
      [
        { url: rollback, host: "kubernetes.io", lines: ["kubectl rollout undo | Kubernetes", "", "## Synopsis", "Roll back to a previous rollout."] },
        { url: deployments, host: "kubernetes.io", lines: ["A Deployment provides declarative updates for Pods and ReplicaSets."] },
      ],
    ));
    const sources = await retrieveEvidence({ client: { webSearch } as unknown as GroqClient, facts, branch: "A", actorId: "actor", topic: "engineering" });

    expect(sources.map((source) => source.url)).toEqual([rollback, deployments]);
    expect(sources[0]?.title).toBe("kubectl rollout undo");
    expect(sources[0]?.snippet).toBe("kubectl rollout undo | Kubernetes ## Synopsis Roll back to a previous rollout.");
    expect(webSearch).toHaveBeenCalledTimes(1);
  });

  it("drops off-list domains from a trusted search because browser_search does not enforce the domain list", async () => {
    const offList = "https://www.groundcover.com/learn/kubernetes/deployment-rollback";
    const webSearch = vi.fn().mockResolvedValue(browserResponse(
      [{ url: offList, title: "Kubernetes Deployment Rollback" }, { url: rollback, title: "kubectl rollout undo" }],
      [
        { url: offList, host: "www.groundcover.com", lines: ["Rollback strategies and best practices for Kubernetes deployments."] },
        { url: rollback, host: "kubernetes.io", lines: ["Roll back to a previous rollout of a Deployment."] },
      ],
    ));
    const sources = await retrieveEvidence({ client: { webSearch } as unknown as GroqClient, facts, branch: "A", actorId: "actor", topic: "engineering" });

    // Trusted searches keep only kubernetes.io; the broad search may then use groundcover.com.
    expect(sources.map((source) => source.hostname)).toEqual(["kubernetes.io", "www.groundcover.com"]);
    expect(sources.map((source) => source.sourceTier)).toEqual([1, 3]);
    expect(webSearch.mock.calls[1]?.[0].includeDomains).toBeUndefined();
  });
});

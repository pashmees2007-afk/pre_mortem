import { randomUUID } from "node:crypto";
import type { EvidenceSource, PlanFacts } from "./contracts.js";
import { GroqClient } from "./groq.js";

const TIER_ONE_DOMAINS = new Set(["kubernetes.io", "docs.kubernetes.io", "sre.google", "github.blog", "blog.cloudflare.com", "aws.amazon.com", "docs.aws.amazon.com", "learn.microsoft.com", "docs.stripe.com", "developer.mozilla.org"]);
const TIER_TWO_SUFFIXES = [".edu", ".gov", ".org"];

function classifyTier(hostname: string): 1 | 2 | 3 {
  if (TIER_ONE_DOMAINS.has(hostname)) return 1;
  if (TIER_TWO_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return 2;
  return 3;
}

function branchQuery(facts: PlanFacts, branch: "A" | "B", plannedQuery?: string) {
  if (plannedQuery) return plannedQuery.slice(0, 900);
  const focus = branch === "A"
    ? `scope planning delivery capacity requirements ${facts.timeline} ${facts.team}`
    : `architecture dependencies reliability operational readiness ${facts.technicalChanges.join(" ")}`;
  return `${facts.outcome} engineering project failure postmortem ${focus}`.slice(0, 900);
}

function extractEvidence(args: { response: Awaited<ReturnType<GroqClient["webSearch"]>>; branch: "A" | "B"; seen: Set<string>; sources: EvidenceSource[] }) {
  const { response, branch, seen, sources } = args;
  const tools = response.choices?.[0]?.message?.executed_tools ?? [];
  const raw = tools.flatMap((tool: any) => {
    const searchResults = tool?.search_results;
    if (Array.isArray(searchResults)) return searchResults;
    if (Array.isArray(searchResults?.results)) return searchResults.results;
    return [];
  });
  const now = new Date().toISOString();
  for (const item of raw) {
    try {
      const url = new URL(String(item.url));
      const title = String(item.title ?? "").trim();
      const snippet = String(item.content ?? item.snippet ?? "").trim();
      if (url.protocol !== "https:" || !title || snippet.length < 20 || seen.has(url.toString())) continue;
      seen.add(url.toString());
      sources.push({
        id: randomUUID(), branch, url: url.toString(), hostname: url.hostname.toLowerCase(),
        title: title.slice(0, 300), publisher: url.hostname.replace(/^www\./, "") || null,
        snippet: snippet.slice(0, 1_500), providerRank: typeof item.score === "number" ? item.score : null,
        sourceTier: classifyTier(url.hostname.toLowerCase()), status: "retrieved", retrievedAt: now,
      });
      if (sources.length === 8) break;
    } catch { /* discard malformed provider records */ }
  }
}

export async function retrieveEvidence(args: { client: GroqClient; facts: PlanFacts; branch: "A" | "B"; actorId: string; includeDomains?: string[]; plannedQuery?: string }): Promise<EvidenceSource[]> {
  const query = branchQuery(args.facts, args.branch, args.plannedQuery);
  const trustedDomains = args.includeDomains?.length ? args.includeDomains : [...TIER_ONE_DOMAINS];
  const seen = new Set<string>();
  const sources: EvidenceSource[] = [];
  const trustedQuery = `Find official engineering documentation, production guidance, or incident learning relevant to this project-risk question. ${query}`;
  const trustedResponse = await args.client.webSearch({ query: trustedQuery, actorId: args.actorId, includeDomains: trustedDomains });
  extractEvidence({ response: trustedResponse, branch: args.branch, seen, sources });
  if (sources.length >= 2) return sources;

  // Tier-1 material is prioritised, not fabricated: broad search fills only the remaining evidence slots.
  const broadResponse = await args.client.webSearch({ query, actorId: args.actorId });
  extractEvidence({ response: broadResponse, branch: args.branch, seen, sources });
  if (sources.length >= 2) return sources;

  // Some narrow research angles yield a single result. Ask again for official guidance before declaring evidence insufficient.
  const trustedRetry = await args.client.webSearch({
    query: `Find an additional official engineering source for a pre-mortem. Project outcome: ${args.facts.outcome}. Missing controls: ${args.facts.missingControls.join("; ")}`.slice(0, 900),
    actorId: args.actorId,
    includeDomains: trustedDomains,
  });
  extractEvidence({ response: trustedRetry, branch: args.branch, seen, sources });
  return sources;
}

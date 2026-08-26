import { randomUUID } from "node:crypto";
import type { EvidenceSource, PlanFacts } from "./contracts.js";
import { GroqClient } from "./groq.js";

const TIER_ONE_DOMAINS = new Set(["sre.google", "github.blog", "blog.cloudflare.com", "aws.amazon.com", "learn.microsoft.com"]);
const TIER_TWO_SUFFIXES = [".edu", ".gov", ".org"];

function classifyTier(hostname: string): 1 | 2 | 3 {
  if (TIER_ONE_DOMAINS.has(hostname)) return 1;
  if (TIER_TWO_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return 2;
  return 3;
}

function branchQuery(facts: PlanFacts, branch: "A" | "B") {
  const focus = branch === "A"
    ? `scope planning delivery capacity requirements ${facts.timeline} ${facts.team}`
    : `architecture dependencies reliability operational readiness ${facts.technicalChanges.join(" ")}`;
  return `${facts.outcome} engineering project failure postmortem ${focus}`.slice(0, 900);
}

export async function retrieveEvidence(args: { client: GroqClient; facts: PlanFacts; branch: "A" | "B"; actorId: string; includeDomains?: string[] }): Promise<EvidenceSource[]> {
  const response = await args.client.webSearch({
    query: branchQuery(args.facts, args.branch),
    actorId: args.actorId,
    includeDomains: args.includeDomains,
  });
  const tools = response.choices?.[0]?.message?.executed_tools ?? [];
  const raw = tools.flatMap((tool: any) => {
    const searchResults = tool?.search_results;
    if (Array.isArray(searchResults)) return searchResults;
    if (Array.isArray(searchResults?.results)) return searchResults.results;
    return [];
  });
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const sources: EvidenceSource[] = [];
  for (const item of raw) {
    try {
      const url = new URL(String(item.url));
      const title = String(item.title ?? "").trim();
      const snippet = String(item.content ?? item.snippet ?? "").trim();
      if (url.protocol !== "https:" || !title || snippet.length < 20 || seen.has(url.toString())) continue;
      seen.add(url.toString());
      sources.push({
        id: randomUUID(), branch: args.branch, url: url.toString(), hostname: url.hostname.toLowerCase(),
        title: title.slice(0, 300), publisher: url.hostname.replace(/^www\./, "") || null,
        snippet: snippet.slice(0, 1_500), providerRank: typeof item.score === "number" ? item.score : null,
        sourceTier: classifyTier(url.hostname.toLowerCase()), status: "retrieved", retrievedAt: now,
      });
      if (sources.length === 8) break;
    } catch { /* discard malformed provider records */ }
  }
  return sources;
}

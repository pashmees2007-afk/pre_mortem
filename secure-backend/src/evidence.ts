import { randomUUID } from "node:crypto";
import type { EvidenceSource, PlanFacts } from "./contracts.js";
import { GroqClient } from "./groq.js";

export type EvidenceTopic = "engineering" | "fintech";
type Branch = "A" | "B";

// Each branch gets its own half of the Tier-1 set, split by publishing organisation and
// assigned to the same branch in both topics, so the two lines of investigation never
// draw on the same publisher's guidance.
const TIER_ONE_BY_TOPIC: Record<EvidenceTopic, Record<Branch, string[]>> = {
  engineering: {
    A: ["kubernetes.io", "docs.kubernetes.io", "learn.microsoft.com", "docs.stripe.com", "developer.mozilla.org"],
    B: ["sre.google", "github.blog", "blog.cloudflare.com", "aws.amazon.com", "docs.aws.amazon.com"],
  },
  fintech: {
    A: ["fsb.org", "bankofengland.co.uk", "fca.org.uk", "ico.org.uk", "docs.stripe.com"],
    B: ["ofac.treasury.gov", "bsaaml.ffiec.gov", "fincen.gov", "aws.amazon.com", "sre.google"],
  },
};
const TIER_ONE_DOMAINS = new Set(Object.values(TIER_ONE_BY_TOPIC).flatMap((byBranch) => [...byBranch.A, ...byBranch.B]));
const TIER_TWO_SUFFIXES = [".edu", ".gov", ".org"];
const SECOND_LEVEL_LABELS = new Set(["co", "ac", "gov", "org", "com", "net"]);

/** The organisation-level site a hostname belongs to, e.g. docs.aws.amazon.com -> amazon.com, bankofengland.co.uk -> bankofengland.co.uk. */
export function siteKey(hostname: string) {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL_LABELS.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export function tierOneDomainsFor(topic: EvidenceTopic, branch: Branch) {
  return TIER_ONE_BY_TOPIC[topic][branch];
}

function classifyTier(hostname: string): 1 | 2 | 3 {
  const canonicalHostname = hostname.toLowerCase().replace(/^www\./, "");
  if (TIER_ONE_DOMAINS.has(canonicalHostname)) return 1;
  if (TIER_TWO_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return 2;
  return 3;
}

/** Chosen once per run from the plan and both branch queries, so the two branches split the same Tier-1 set. */
export function evidenceTopicFor(facts: PlanFacts, plannedQueries: Array<string | undefined> = []): EvidenceTopic {
  const context = [facts.outcome, facts.dependencies.join(" "), facts.technicalChanges.join(" "), facts.missingControls.join(" "), ...plannedQueries.map((query) => query ?? "")].join(" ").toLowerCase();
  const fintechPattern = /fintech|payment|wallet|payout|settlement|reconciliation|kyc|aml|sanction|bank|funds|card|currency|financial/;
  return fintechPattern.test(context) ? "fintech" : "engineering";
}

function branchQuery(facts: PlanFacts, branch: Branch, plannedQuery?: string) {
  if (plannedQuery) return plannedQuery.slice(0, 900);
  const focus = branch === "A"
    ? `scope planning delivery capacity requirements ${facts.timeline} ${facts.team}`
    : `architecture dependencies reliability operational readiness ${facts.technicalChanges.join(" ")}`;
  return `${facts.outcome} engineering project failure postmortem ${focus}`.slice(0, 900);
}

// GPT-OSS browser_search labels an opened page "<host> - viewing lines [0 - 96] of 96" and prefixes each line with "L12: ".
const PAGE_VIEW_TITLE = /\s-\sviewing lines \[\d+ - \d+\] of \d+$/;

function pageText(raw: string) {
  return raw.split("\n")
    .map((line) => line.replace(/^L\d+:\s?/, "").trim())
    .filter((line) => line && line !== "URL:" && !/^(URL:\s*)?https?:\/\/\S+$/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function onDomain(hostname: string, domains: string[]) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

type RawRecord = { title: string; snippet: string; score: number | null };

/** Merges every tool record for one URL: Compound returns title and content together, while GPT-OSS
 * returns a titled but empty search hit and, separately, the opened page's text. */
function collectRecords(response: Awaited<ReturnType<GroqClient["webSearch"]>>) {
  const tools = response.choices?.[0]?.message?.executed_tools ?? [];
  const raw = tools.flatMap((tool: any) => {
    const searchResults = tool?.search_results;
    if (Array.isArray(searchResults)) return searchResults;
    if (Array.isArray(searchResults?.results)) return searchResults.results;
    return [];
  });
  const records = new Map<string, RawRecord>();
  for (const item of raw) {
    try {
      const url = new URL(String(item.url)).toString();
      const rawTitle = String(item.title ?? "").trim();
      const title = PAGE_VIEW_TITLE.test(rawTitle) ? "" : rawTitle;
      const snippet = pageText(String(item.content ?? item.snippet ?? ""));
      const score = typeof item.score === "number" ? item.score : null;
      const existing = records.get(url);
      if (!existing) { records.set(url, { title, snippet, score }); continue; }
      if (!existing.title) existing.title = title;
      if (snippet.length > existing.snippet.length) existing.snippet = snippet;
      existing.score ??= score;
    } catch { /* discard malformed provider records */ }
  }
  return records;
}

function extractEvidence(args: { response: Awaited<ReturnType<GroqClient["webSearch"]>>; branch: Branch; seen: Set<string>; excludedSites: Set<string>; sources: EvidenceSource[]; onlyDomains?: string[] }) {
  const { response, branch, seen, excludedSites, sources, onlyDomains } = args;
  const now = new Date().toISOString();
  for (const [href, item] of collectRecords(response)) {
    const url = new URL(href);
    const { title, snippet } = item;
    if (url.protocol !== "https:" || !title || snippet.length < 20 || seen.has(href) || excludedSites.has(siteKey(url.hostname))) continue;
    // A trusted search is a promise about domains, so it is enforced here rather than left to the provider.
    if (onlyDomains?.length && !onDomain(url.hostname, onlyDomains)) continue;
    seen.add(href);
    sources.push({
      id: randomUUID(), branch, url: href, hostname: url.hostname.toLowerCase(),
      title: title.slice(0, 300), publisher: url.hostname.replace(/^www\./, "") || null,
      snippet: snippet.slice(0, 1_500), providerRank: item.score,
      sourceTier: classifyTier(url.hostname.toLowerCase()), status: "retrieved", retrievedAt: now,
    });
    if (sources.length === 8) break;
  }
}

export async function retrieveEvidence(args: {
  client: GroqClient; facts: PlanFacts; branch: Branch; actorId: string; includeDomains?: string[]; plannedQuery?: string;
  topic?: EvidenceTopic;
  /** Hostnames the other branch already retained; their whole sites are off-limits to this branch. */
  excludeHostnames?: string[];
}): Promise<EvidenceSource[]> {
  const query = branchQuery(args.facts, args.branch, args.plannedQuery);
  const topic = args.topic ?? evidenceTopicFor(args.facts, [args.plannedQuery]);
  const trustedDomains = args.includeDomains?.length ? args.includeDomains : tierOneDomainsFor(topic, args.branch);
  const otherBranch: Branch = args.branch === "A" ? "B" : "A";
  // The other branch's reserved publishers and every site it actually used are excluded, so the two evidence
  // pools never share a website even when the unrestricted broad search surfaces one.
  const excludedSites = new Set([...tierOneDomainsFor(topic, otherBranch), ...(args.excludeHostnames ?? [])].map(siteKey));
  const seen = new Set<string>();
  const sources: EvidenceSource[] = [];
  const trustedQuery = `Find official guidance, control expectations, engineering documentation, production guidance, or incident learning relevant to this project-risk question. ${query}`;
  const trustedResponse = await args.client.webSearch({ query: trustedQuery, actorId: args.actorId, includeDomains: trustedDomains });
  extractEvidence({ response: trustedResponse, branch: args.branch, seen, excludedSites, sources, onlyDomains: trustedDomains });
  if (sources.length >= 2) return sources;

  // Tier-1 material is prioritised, not fabricated: broad search fills only the remaining evidence slots.
  const broadResponse = await args.client.webSearch({ query, actorId: args.actorId });
  extractEvidence({ response: broadResponse, branch: args.branch, seen, excludedSites, sources });
  if (sources.length >= 2) return sources;

  // Some narrow research angles yield a single result. Ask again for official guidance before declaring evidence insufficient.
  const trustedRetry = await args.client.webSearch({
    query: `Find an additional official engineering source for a pre-mortem. Project outcome: ${args.facts.outcome}. Missing controls: ${args.facts.missingControls.join("; ")}`.slice(0, 900),
    actorId: args.actorId,
    includeDomains: trustedDomains,
  });
  extractEvidence({ response: trustedRetry, branch: args.branch, seen, excludedSites, sources, onlyDomains: trustedDomains });
  return sources;
}

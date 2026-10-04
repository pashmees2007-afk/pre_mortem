import type { Config } from "./config.js";
import { UpstreamError } from "./errors.js";
import { GroqClient } from "./groq.js";

export type WebSearchArgs = {
  /** The research query itself; Tavily searches with this alone. */
  query: string;
  /** Natural-language framing for an LLM searcher ("find official guidance ..."); a search API ignores it. */
  instruction?: string;
  actorId: string;
  includeDomains?: string[];
};

/** Every searcher returns its records in Groq's tool-record shape, so evidence.ts has one parser. */
export type WebSearchResponse = {
  choices?: Array<{ message?: { content?: string; executed_tools?: unknown[] } }>;
};

export interface WebSearcher {
  /** Groq searches draw on the same per-minute token budget as the reasoning stages; a search API does not. */
  readonly sharesGroqBudget: boolean;
  webSearch(args: WebSearchArgs): Promise<WebSearchResponse>;
  /** Searches billed outside Groq (e.g. Tavily credits); absent when searches are Groq requests already in the usage totals. */
  getSearchCount?(): number;
}

// Tavily rejects longer queries outright, so the query is trimmed rather than sent to fail.
const TAVILY_MAX_QUERY_CHARS = 400;

export class TavilyClient implements WebSearcher {
  readonly sharesGroqBudget = false;
  private searches = 0;

  constructor(private readonly config: Config & { TAVILY_API_KEY: string }) {}

  /** Successful searches made by this instance; basic-depth searches cost one Tavily credit each. */
  getSearchCount() {
    return this.searches;
  }

  async webSearch(args: WebSearchArgs): Promise<WebSearchResponse> {
    let response: Response;
    try {
      response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.TAVILY_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: args.query.replace(/\s+/g, " ").trim().slice(0, TAVILY_MAX_QUERY_CHARS),
          search_depth: "basic",
          topic: "general",
          max_results: 8,
          // Unlike GPT-OSS browser_search, Tavily enforces this list; evidence.ts still re-checks it.
          include_domains: args.includeDomains?.length ? args.includeDomains : undefined,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        signal: AbortSignal.timeout(this.config.ANALYSIS_TIMEOUT_MS),
      });
    } catch {
      throw new UpstreamError("The evidence search provider timed out");
    }
    const payload = await response.json().catch(() => null) as { results?: unknown[]; detail?: { error?: string } | string } | null;
    if (!response.ok) {
      const detail = payload?.detail;
      const message = typeof detail === "string" ? detail : detail?.error;
      throw new UpstreamError(message || "The evidence search provider rejected the request", response.status === 429 ? 429 : 502);
    }
    this.searches += 1;
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return { choices: [{ message: { executed_tools: [{ type: "tavily_search", search_results: { results } }] } }] };
  }
}

/** Tavily when TAVILY_API_KEY is configured; otherwise the Groq retrieval model searches. */
export function createSearcher(config: Config, groq: GroqClient): WebSearcher {
  return config.TAVILY_API_KEY ? new TavilyClient({ ...config, TAVILY_API_KEY: config.TAVILY_API_KEY }) : groq;
}

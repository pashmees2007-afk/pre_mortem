import { z } from "zod";
import type { Config } from "./config.js";
import { UpstreamError } from "./errors.js";

type GroqMessage = { role: "system" | "user"; content: string };
type GroqResponse = {
  choices?: Array<{ message?: { content?: string; executed_tools?: unknown[] } }>;
};

export class GroqClient {
  constructor(private readonly config: Config) {}

  private async request(body: Record<string, unknown>): Promise<GroqResponse> {
    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.GROQ_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.ANALYSIS_TIMEOUT_MS),
      });
    } catch {
      throw new UpstreamError("The analysis provider timed out");
    }
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | GroqResponse | null;
    if (!response.ok) {
      const message = (payload as { error?: { message?: string } } | null)?.error?.message;
      throw new UpstreamError(message || "The analysis provider rejected the request", response.status === 429 ? 429 : 502);
    }
    return payload as GroqResponse;
  }

  async strictJson<T extends z.ZodType>(args: { model?: string; name: string; schema: Record<string, unknown>; output: T; system: string; user: string; actorId: string; maxCompletionTokens?: number }) {
    const request = {
      model: args.model ?? this.config.GROQ_STRUCTURED_MODEL,
      temperature: 0,
      max_completion_tokens: args.maxCompletionTokens ?? 1_400,
      user: args.actorId,
      messages: [{ role: "system", content: args.system }, { role: "user", content: args.user }] satisfies GroqMessage[],
    };
    let raw: GroqResponse;
    try {
      raw = await this.request({
        ...request,
      response_format: { type: "json_schema", json_schema: { name: args.name, strict: true, schema: args.schema } },
      });
    } catch (error) {
      if (!(error instanceof UpstreamError) || !error.message.includes("Failed to validate JSON")) throw error;
      raw = await this.request({ ...request, response_format: { type: "json_object" } });
    }
    const text = raw.choices?.[0]?.message?.content;
    if (!text) throw new UpstreamError("The analysis provider returned an empty response");
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new UpstreamError("The analysis provider returned invalid JSON"); }
    const parsed = args.output.safeParse(json);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "root").slice(0, 5).join(", ");
      throw new UpstreamError(`${args.name}: the analysis provider returned an invalid result shape for ${fields}`);
    }
    return parsed.data;
  }

  async webSearch(args: { query: string; actorId: string; includeDomains?: string[] }) {
    return this.request({
      model: this.config.GROQ_RETRIEVAL_MODEL,
      temperature: 0,
      max_completion_tokens: 450,
      user: args.actorId,
      search_settings: args.includeDomains?.length ? { include_domains: args.includeDomains } : undefined,
      messages: [{ role: "user", content: `Find software-engineering failure precedents for this bounded research query. Return concise source-grounded findings. QUERY: ${args.query}` }] satisfies GroqMessage[],
    });
  }
}

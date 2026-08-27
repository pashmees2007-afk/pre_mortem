import { z } from "zod";
import type { Config } from "./config.js";
import { UpstreamError } from "./errors.js";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

function retryDelayMs(message: string) {
  const seconds = Number(message.match(/retry in\s+([\d.]+)s/i)?.[1]);
  return Number.isFinite(seconds) ? Math.min(Math.max(Math.ceil(seconds * 1_000), 1_000), 30_000) : 5_000;
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const MAX_ATTEMPTS_PER_STRUCTURED_CALL = 2;

function isDailyQuotaExhausted(message: string) {
  return /perday|per day|daily limit/i.test(message);
}

/** Server-only structured reasoning client. Research remains on Groq because it needs its search-tool response. */
export class GeminiClient {
  constructor(private readonly config: Config) {}

  async strictJson<T extends z.ZodType>(args: {
    name: string;
    schema: Record<string, unknown>;
    output: T;
    system: string;
    user: string;
    actorId: string;
    maxCompletionTokens?: number;
  }) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STRUCTURED_CALL; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.GEMINI_STRUCTURED_MODEL)}:generateContent`,
          {
            method: "POST",
            headers: { "x-goog-api-key": this.config.GEMINI_API_KEY, "content-type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: args.system }] },
              contents: [{ role: "user", parts: [{ text: args.user }] }],
              generationConfig: {
                temperature: 0,
                // Gemini 3.6 Flash uses part of the budget for internal reasoning before emitting JSON.
                maxOutputTokens: Math.max(args.maxCompletionTokens ?? 1_400, 1_000),
                responseMimeType: "application/json",
                responseJsonSchema: args.schema,
              },
            }),
            signal: AbortSignal.timeout(this.config.ANALYSIS_TIMEOUT_MS),
          },
        );
      } catch {
        throw new UpstreamError("The structured reasoning provider timed out");
      }

      const payload = await response.json().catch(() => null) as GeminiResponse | null;
      if (!response.ok) {
        const message = payload?.error?.message || "The structured reasoning provider rejected the request";
        // Do not waste another request on the provider's per-day ceiling. A short
        // rate window can recover once; seven workflow stages therefore use at most
        // 14 Gemini requests in a full analysis.
        if (response.status === 429 && !isDailyQuotaExhausted(message) && attempt < MAX_ATTEMPTS_PER_STRUCTURED_CALL - 1) {
          await pause(this.config.NODE_ENV === "test" ? 0 : retryDelayMs(message));
          continue;
        }
        throw new UpstreamError(message, response.status === 429 ? 429 : 502);
      }
      const text = payload?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
      if (!text) throw new UpstreamError(`${args.name}: the structured reasoning provider returned an empty response`);
      let json: unknown;
      try { json = JSON.parse(text); } catch { throw new UpstreamError(`${args.name}: the structured reasoning provider returned invalid JSON`); }
      const parsed = args.output.safeParse(json);
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "root").slice(0, 5).join(", ");
        throw new UpstreamError(`${args.name}: the structured reasoning provider returned an invalid result shape for ${fields}`);
      }
      return parsed.data;
    }
    throw new UpstreamError("The structured reasoning provider did not return after retrying");
  }
}

/**
 * The copilot's language model, whichever provider answers (D-A revised on 30 September 2026, Fase 5 C0).
 *
 * One shape for every provider, so the tasks (drafts, summaries, briefings, extraction…) are
 * written once and never name a vendor. Adding a provider is a file implementing `AiProvider`
 * and one line in ./registry.ts; changing the model is an environment variable, not a deploy
 * of new code (./config.ts).
 *
 * ⚠️ Everything here is plain `fetch`: it runs on Workers, adds nothing to the bundle, and a
 * test hands in its own.
 *
 * ⚠️⚠️ The model proposes, a person confirms. Nothing in this module writes to the CRM or
 * sends anything to a customer: it returns text, and what happens to it is the caller's
 * business — through the same server actions and permissions as a person's own edit.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The providers this deployment knows how to call. */
export type AiProviderId = "gemini" | "openai";
export const AI_PROVIDER_IDS: readonly AiProviderId[] = ["gemini", "openai"];

/**
 * What the copilot is asked to do (Fase 5, C1–C8). Each can be routed to its own provider and
 * model (./config.ts): classifying a thousand emails and drafting one reply are different jobs.
 */
export type AiTask =
  | "draft"
  | "rewrite"
  | "summary"
  | "briefing"
  | "call_note"
  | "extract"
  | "classify"
  | "next_steps"
  | "ask";
export const AI_TASKS: readonly AiTask[] = [
  "draft",
  "rewrite",
  "summary",
  "briefing",
  "call_note",
  "extract",
  "classify",
  "next_steps",
  "ask",
];

/** One turn of the conversation with the model. */
export interface AiMessage {
  role: "user" | "assistant";
  text: string;
}

/** A JSON Schema, as the provider receives it. */
export type JsonSchema = Record<string, unknown>;

export interface AiRequest {
  /**
   * Flux's instructions. ⚠️ Never a customer's words: text a customer wrote goes in `messages`,
   * marked as material to work on, so it is read as data and not obeyed.
   */
  system: string;
  messages: AiMessage[];
  /** A ceiling, not a target. An answer that reaches it comes back with `truncated: true`. */
  maxOutputTokens: number;
  temperature?: number;
  /** Plain text unless a schema is given, in which case the answer is JSON meant to match it. */
  output?: { kind: "text" } | { kind: "json"; schema: JsonSchema };
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens the model spent thinking, billed as output by the providers that report them. */
  reasoningTokens: number;
  /** Input tokens served from the provider's cache. */
  cachedInputTokens: number;
}

/**
 * Why a call produced nothing usable, the same words whichever provider said it.
 *
 * - `off` — no provider is configured: the copilot is not available here;
 * - `config` — a provider is configured wrongly (unknown name, malformed model id): whoever
 *   operates the deployment has to fix it;
 * - `auth` — the provider refused the key;
 * - `model` — the provider does not serve this model to this key (a model retired, or one the
 *   provider keeps to earlier users): change the model in the configuration;
 * - `invalid` — the provider refused the request itself;
 * - `blocked` — the provider's safety filters refused the prompt or the answer;
 * - `rate_limited` — too many calls, or the quota is spent: try later;
 * - `unavailable` — the provider did not answer, answered 5xx, or the call timed out;
 * - `output` — an answer came back but is not what was asked for (JSON that does not parse or
 *   does not match, or cut off at the token ceiling).
 */
export type AiFailureReason =
  | "off"
  | "config"
  | "auth"
  | "model"
  | "invalid"
  | "blocked"
  | "rate_limited"
  | "unavailable"
  | "output";

export type AiResult =
  | {
      ok: true;
      text: string;
      /** The answer stopped at `maxOutputTokens`: it is incomplete. */
      truncated: boolean;
      usage: AiUsage;
      provider: AiProviderId;
      model: string;
    }
  | {
      ok: false;
      reason: AiFailureReason;
      /**
       * For the log and for whoever operates the deployment. ⚠️ Never the request: it carries a
       * customer's data. The provider's own words are kept, cut short.
       */
      message: string;
      /** What was spent before it failed, when the provider said. */
      usage: AiUsage | null;
      provider: AiProviderId | null;
      model: string | null;
    };

export type AiFailure = Extract<AiResult, { ok: false }>;

/** A streamed answer: text as it arrives, then one `end` with the whole result. */
export type AiStreamEvent = { type: "text"; text: string } | { type: "end"; result: AiResult };

/** What a provider needs for one call. */
export interface AiCallContext {
  model: string;
  apiKey: string;
  fetch: FetchLike;
  signal?: AbortSignal;
}

export interface AiProvider {
  id: AiProviderId;
  /** How the settings name it. */
  label: string;
  /** The environment variable holding its key. */
  keyVariable: string;
  /** The model used when the configuration names none. */
  defaultModel: string;
  generate(request: AiRequest, context: AiCallContext): Promise<AiResult>;
  stream(request: AiRequest, context: AiCallContext): AsyncGenerator<AiStreamEvent>;
}

export const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };

/**
 * What a screen shows for a copilot control (src/lib/ai/access.ts, `aiEntries`): ready, or
 * disabled with the reason the person can act on. Here, not in access.ts, because client
 * components read it and access.ts is server only.
 */
export type AiEntry = { state: "ready" } | { state: "unavailable"; reason: "off" | "config" | "plan" };

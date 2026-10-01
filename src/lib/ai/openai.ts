/**
 * OpenAI's Responses API (https://developers.openai.com/api/reference/resources/responses), behind
 * `AiProvider`.
 *
 * Written against the published REST contract and tested with recorded answers (./openai.test.ts):
 * `Authorization: Bearer` for the key, `instructions` for Flux's instructions, `input` for the
 * conversation, `text.format` for structured answers, Server-Sent Events for streaming.
 *
 * ⚠️⚠️ **A reasoning model spends its thinking out of `max_output_tokens`.** The GPT-5 and o-series
 * models think before they answer, and that thinking is billed and counted as output: with Flux's
 * ceilings (a draft is 1,200) a model left on its default effort can spend all of it thinking and
 * answer nothing — `incomplete`, empty. So for those models the effort is `low` unless
 * `OPENAI_REASONING_EFFORT` says otherwise, and the ceiling sent carries a thinking allowance on top
 * of the answer's. They also refuse `temperature`, which is left out for them.
 *
 * ⚠️ `store: false`: OpenAI keeps nothing of the call for later retrieval. A prompt carries a
 * customer's record.
 *
 * ⚠️ A message of a reasoning model can be `phase: "commentary"` — its working, not its answer. Only
 * the rest is the answer, streamed or not, as Gemini's `thought` parts are left out.
 */
import { sseData } from "./sse";
import {
  type AiCallContext,
  type AiFailure,
  type AiFailureReason,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiStreamEvent,
  type AiUsage,
  type JsonSchema,
  NO_USAGE,
} from "./types";

const ENDPOINT = "https://api.openai.com/v1/responses";

/** What a reasoning model may spend thinking, on top of the answer's own ceiling. */
const THINKING_ALLOWANCE = 2048;

const EFFORTS = new Set(["none", "minimal", "low", "medium", "high"]);

interface OpenAiContent {
  type?: string;
  text?: string;
  refusal?: string;
}

interface OpenAiItem {
  id?: string;
  type?: string;
  phase?: string;
  content?: OpenAiContent[];
}

interface OpenAiResponse {
  status?: string;
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: OpenAiItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  } | null;
}

interface OpenAiError {
  error?: { message?: string; type?: string; code?: string | null };
}

/** The GPT-5 family and the o-series think before answering and refuse `temperature`. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

/**
 * A schema OpenAI can enforce strictly: every object lists all its properties as required. Strict
 * mode also wants `additionalProperties: false` on each object, added here; a schema with optional
 * properties is sent as guidance only, and the answer is checked by the caller either way.
 */
export function strictSchema(schema: JsonSchema): JsonSchema | null {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== "object" || node === null) return node;
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = walk(v);
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      const keys = Object.keys(obj.properties as object);
      const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
      if (keys.some((k) => !required.includes(k))) throw new Error("not strict");
      out.additionalProperties = false;
    }
    return out;
  };
  try {
    return walk(schema) as JsonSchema;
  } catch {
    return null;
  }
}

export function openAiBody(request: AiRequest, model: string, env: Record<string, string | undefined> = process.env) {
  const reasoning = isReasoningModel(model);
  const body: Record<string, unknown> = {
    model,
    instructions: request.system,
    input: request.messages.map((message) => ({ role: message.role, content: message.text })),
    max_output_tokens: request.maxOutputTokens + (reasoning ? THINKING_ALLOWANCE : 0),
    store: false,
  };
  if (reasoning) {
    const effort = env.OPENAI_REASONING_EFFORT?.trim();
    body.reasoning = { effort: effort && EFFORTS.has(effort) ? effort : "low" };
  } else if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  if (request.output?.kind === "json") {
    const strict = strictSchema(request.output.schema);
    body.text = {
      format: { type: "json_schema", name: "answer", schema: strict ?? request.output.schema, strict: strict !== null },
    };
  }
  return body;
}

function post(request: AiRequest, context: AiCallContext, stream: boolean) {
  return context.fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.apiKey}` },
    body: JSON.stringify({ ...openAiBody(request, context.model), ...(stream ? { stream: true } : {}) }),
    signal: context.signal,
  });
}

/** The answer's text and whether the model refused, from the output items. */
function answerOf(response: OpenAiResponse): { text: string; refusal: string | null } {
  let text = "";
  let refusal: string | null = null;
  for (const item of response.output ?? []) {
    if (item.type !== "message" || item.phase === "commentary") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
      if (part.type === "refusal") refusal = part.refusal ?? "refused";
    }
  }
  return { text, refusal };
}

export function openAiUsage(response: OpenAiResponse): AiUsage | null {
  const u = response.usage;
  if (!u) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
    cachedInputTokens: u.input_tokens_details?.cached_tokens ?? 0,
  };
}

/** An HTTP failure in Flux's words. */
export function openAiFailure(status: number, raw: string): { reason: AiFailureReason; message: string } {
  let body: OpenAiError = {};
  try {
    body = JSON.parse(raw) as OpenAiError;
  } catch {
    // Not JSON: a proxy or a gateway answered. The status is all there is.
  }
  const code = body.error?.code ?? body.error?.type ?? "";
  const message = `OpenAI answered ${status}${code ? ` ${code}` : ""}: ${(body.error?.message ?? raw).slice(0, 300)}`;
  if (code === "model_not_found" || status === 404) return { reason: "model", message };
  if (status === 401 || status === 403 || code === "invalid_api_key") return { reason: "auth", message };
  // ⚠️ A spent quota is a 429 too: "try later" is still the honest answer, and the message says which.
  if (status === 429) return { reason: "rate_limited", message };
  if (status === 408 || status >= 500) return { reason: "unavailable", message };
  return { reason: "invalid", message };
}

/** Why the answer ended, once the whole of it is known. */
function ending(
  response: OpenAiResponse,
  refusal: string | null,
): { ok: true; truncated: boolean } | { ok: false; reason: AiFailureReason; message: string } {
  if (refusal) return { ok: false, reason: "blocked", message: `OpenAI refused: ${refusal.slice(0, 200)}` };
  if (response.status === "completed") return { ok: true, truncated: false };
  if (response.status === "incomplete") {
    const why = response.incomplete_details?.reason;
    if (why === "content_filter")
      return { ok: false, reason: "blocked", message: "OpenAI stopped the answer: content_filter" };
    return { ok: true, truncated: true };
  }
  const error = response.error;
  return {
    ok: false,
    reason: "unavailable",
    message: `OpenAI ended without an answer: ${error?.code ?? response.status ?? "no status"}${
      error?.message ? ` ${error.message.slice(0, 200)}` : ""
    }`,
  };
}

function unreachable(error: unknown, context: AiCallContext): AiFailure {
  // A DOMException is not an Error in every runtime: read the name, not the class.
  const name = (error as { name?: unknown } | null)?.name;
  const timedOut = name === "TimeoutError" || name === "AbortError";
  return {
    ok: false,
    reason: "unavailable",
    message: timedOut ? "OpenAI did not answer in time" : `OpenAI unreachable: ${String(error).slice(0, 200)}`,
    usage: null,
    provider: "openai",
    model: context.model,
  };
}

function result(response: OpenAiResponse, text: string, refusal: string | null, context: AiCallContext): AiResult {
  const usage = openAiUsage(response);
  const end = ending(response, refusal);
  if (!end.ok) return { ...end, usage, provider: "openai", model: context.model };
  // An incomplete answer with nothing in it is no answer: the thinking took the whole ceiling.
  if (end.truncated && !text) {
    return {
      ok: false,
      reason: "output",
      message: `OpenAI spent the whole ceiling without answering (${response.incomplete_details?.reason ?? "incomplete"})`,
      usage,
      provider: "openai",
      model: context.model,
    };
  }
  return {
    ok: true,
    text,
    truncated: end.truncated,
    usage: usage ?? NO_USAGE,
    provider: "openai",
    model: context.model,
  };
}

async function generate(request: AiRequest, context: AiCallContext): Promise<AiResult> {
  let res: Response;
  let raw: string;
  try {
    res = await post(request, context, false);
    raw = await res.text();
  } catch (error) {
    return unreachable(error, context);
  }
  if (!res.ok)
    return { ok: false, ...openAiFailure(res.status, raw), usage: null, provider: "openai", model: context.model };

  let response: OpenAiResponse;
  try {
    response = JSON.parse(raw) as OpenAiResponse;
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "OpenAI answered with something that is not JSON",
      usage: null,
      provider: "openai",
      model: context.model,
    };
  }
  const { text, refusal } = answerOf(response);
  return result(response, text, refusal, context);
}

interface StreamEvent {
  type?: string;
  delta?: string;
  item_id?: string;
  item?: OpenAiItem;
  response?: OpenAiResponse;
  code?: string;
  message?: string;
}

async function* stream(request: AiRequest, context: AiCallContext): AsyncGenerator<AiStreamEvent> {
  let res: Response;
  try {
    res = await post(request, context, true);
  } catch (error) {
    yield { type: "end", result: unreachable(error, context) };
    return;
  }
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    yield {
      type: "end",
      result: { ok: false, ...openAiFailure(res.status, raw), usage: null, provider: "openai", model: context.model },
    };
    return;
  }

  let text = "";
  let refusal: string | null = null;
  let final: OpenAiResponse | null = null;
  // A reasoning model's working, streamed like an answer: its items are skipped.
  const commentary = new Set<string>();
  try {
    for await (const data of sseData(res.body)) {
      let event: StreamEvent;
      try {
        event = JSON.parse(data) as StreamEvent;
      } catch {
        continue;
      }
      switch (event.type) {
        case "response.output_item.added":
          if (event.item?.phase === "commentary" && event.item.id) commentary.add(event.item.id);
          break;
        case "response.output_text.delta":
          if (event.delta && !(event.item_id && commentary.has(event.item_id))) {
            text += event.delta;
            yield { type: "text", text: event.delta };
          }
          break;
        case "response.refusal.done":
          refusal = (event as { refusal?: string }).refusal ?? "refused";
          break;
        case "response.completed":
        case "response.incomplete":
        case "response.failed":
          final = event.response ?? { status: event.type.slice("response.".length) };
          break;
        case "error":
          final = { status: "failed", error: { code: event.code, message: event.message } };
          break;
      }
    }
  } catch (error) {
    // Cut off halfway: what was shown is incomplete, and the caller must say so.
    yield { type: "end", result: { ...unreachable(error, context), usage: final ? openAiUsage(final) : null } };
    return;
  }

  if (!final) {
    yield { type: "end", result: { ...unreachable("the stream ended without a final event", context) } };
    return;
  }
  yield { type: "end", result: result(final, text, refusal, context) };
}

export const openAiProvider: AiProvider = {
  id: "openai",
  label: "OpenAI",
  keyVariable: "OPENAI_API_KEY",
  defaultModel: "gpt-5-mini",
  generate,
  stream,
};

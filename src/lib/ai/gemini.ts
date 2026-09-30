/**
 * Google's Gemini API (the Developer API, https://ai.google.dev/api/generate-content), behind
 * `AiProvider`.
 *
 * Written against the published REST contract and tested with recorded answers
 * (./gemini.test.ts): `x-goog-api-key` for the key, `systemInstruction` for Flux's
 * instructions, `model` as the assistant's role, `responseJsonSchema` for structured answers.
 *
 * ⚠️⚠️ Google keeps the 2.5 models to keys that have used them before, and points new projects
 * at the 3.x Flash-Lite models. A key that cannot use the configured model gets 404 here, which
 * becomes the `model` reason: the fix is `AI_MODEL`, not the code.
 *
 * ⚠️ Data: on the paid tier Google does not use prompts or answers to improve its products and
 * keeps them only for abuse monitoring. The Developer API does not let a request choose where
 * it is processed; processing in the EU is Vertex AI, which would be another provider here.
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
  NO_USAGE,
} from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Finish reasons that mean a filter stopped the answer, not the model. */
const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

interface GeminiPart {
  text?: string;
  /** A thinking summary, not the answer. */
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

interface GeminiError {
  error?: { message?: string; status?: string; details?: { reason?: string }[] };
}

export function geminiBody(request: AiRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: request.maxOutputTokens };
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.output?.kind === "json") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = request.output.schema;
  }
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.text }],
    })),
    generationConfig,
  };
}

function url(model: string, method: "generateContent" | "streamGenerateContent"): string {
  const path = `${BASE_URL}/models/${encodeURIComponent(model)}:${method}`;
  return method === "streamGenerateContent" ? `${path}?alt=sse` : path;
}

function post(request: AiRequest, context: AiCallContext, method: "generateContent" | "streamGenerateContent") {
  return context.fetch(url(context.model, method), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": context.apiKey },
    body: JSON.stringify(geminiBody(request)),
    signal: context.signal,
  });
}

/** The answer's text: every text part except the model's thinking. */
function textOf(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function geminiUsage(response: GeminiResponse): AiUsage | null {
  const u = response.usageMetadata;
  if (!u) return null;
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    reasoningTokens: u.thoughtsTokenCount ?? 0,
    cachedInputTokens: u.cachedContentTokenCount ?? 0,
  };
}

/** An HTTP failure in Flux's words. */
export function geminiFailure(status: number, raw: string): { reason: AiFailureReason; message: string } {
  let body: GeminiError = {};
  try {
    body = JSON.parse(raw) as GeminiError;
  } catch {
    // Not JSON: a proxy or a gateway answered. The status is all there is.
  }
  const message = `Gemini answered ${status}${body.error?.status ? ` ${body.error.status}` : ""}: ${(
    body.error?.message ?? raw
  ).slice(0, 300)}`;
  // ⚠️ A key that does not exist is a 400, not a 401: only the detail says it.
  if (body.error?.details?.some((d) => d.reason === "API_KEY_INVALID")) return { reason: "auth", message };
  if (status === 401 || status === 403) return { reason: "auth", message };
  if (status === 404) return { reason: "model", message };
  if (status === 429) return { reason: "rate_limited", message };
  if (status === 408 || status >= 500) return { reason: "unavailable", message };
  return { reason: "invalid", message };
}

/** Why the answer ended, once the whole of it is known. */
function ending(
  finishReason: string | undefined,
  blockReason: string | undefined,
): { ok: true; truncated: boolean } | { ok: false; reason: AiFailureReason; message: string } {
  if (blockReason) return { ok: false, reason: "blocked", message: `Gemini refused the prompt: ${blockReason}` };
  if (finishReason === "STOP") return { ok: true, truncated: false };
  if (finishReason === "MAX_TOKENS") return { ok: true, truncated: true };
  if (finishReason && BLOCKED.has(finishReason)) {
    return { ok: false, reason: "blocked", message: `Gemini stopped the answer: ${finishReason}` };
  }
  return {
    ok: false,
    reason: "unavailable",
    message: `Gemini ended without an answer: ${finishReason ?? "no candidate"}`,
  };
}

function unreachable(error: unknown, context: AiCallContext): AiFailure {
  // A DOMException is not an Error in every runtime: read the name, not the class.
  const name = (error as { name?: unknown } | null)?.name;
  const timedOut = name === "TimeoutError" || name === "AbortError";
  return {
    ok: false,
    reason: "unavailable",
    message: timedOut ? "Gemini did not answer in time" : `Gemini unreachable: ${String(error).slice(0, 200)}`,
    usage: null,
    provider: "gemini",
    model: context.model,
  };
}

async function generate(request: AiRequest, context: AiCallContext): Promise<AiResult> {
  let res: Response;
  let raw: string;
  try {
    res = await post(request, context, "generateContent");
    raw = await res.text();
  } catch (error) {
    return unreachable(error, context);
  }
  if (!res.ok)
    return { ok: false, ...geminiFailure(res.status, raw), usage: null, provider: "gemini", model: context.model };

  let response: GeminiResponse;
  try {
    response = JSON.parse(raw) as GeminiResponse;
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Gemini answered with something that is not JSON",
      usage: null,
      provider: "gemini",
      model: context.model,
    };
  }
  const usage = geminiUsage(response);
  const end = ending(response.candidates?.[0]?.finishReason, response.promptFeedback?.blockReason);
  if (!end.ok) return { ...end, usage, provider: "gemini", model: context.model };
  return {
    ok: true,
    text: textOf(response),
    truncated: end.truncated,
    usage: usage ?? NO_USAGE,
    provider: "gemini",
    model: context.model,
  };
}

async function* stream(request: AiRequest, context: AiCallContext): AsyncGenerator<AiStreamEvent> {
  let res: Response;
  try {
    res = await post(request, context, "streamGenerateContent");
  } catch (error) {
    yield { type: "end", result: unreachable(error, context) };
    return;
  }
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    yield {
      type: "end",
      result: { ok: false, ...geminiFailure(res.status, raw), usage: null, provider: "gemini", model: context.model },
    };
    return;
  }

  let text = "";
  let finishReason: string | undefined;
  let blockReason: string | undefined;
  let usage: AiUsage | null = null;
  try {
    for await (const data of sseData(res.body)) {
      let chunk: GeminiResponse;
      try {
        chunk = JSON.parse(data) as GeminiResponse;
      } catch {
        continue;
      }
      const delta = textOf(chunk);
      if (delta) {
        text += delta;
        yield { type: "text", text: delta };
      }
      finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
      blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
      // Each chunk reports the running total; the last one is the whole call.
      usage = geminiUsage(chunk) ?? usage;
    }
  } catch (error) {
    // Cut off halfway: what was shown is incomplete, and the caller must say so.
    const result = unreachable(error, context);
    yield { type: "end", result: { ...result, usage } };
    return;
  }

  const end = ending(finishReason, blockReason);
  yield {
    type: "end",
    result: end.ok
      ? { ok: true, text, truncated: end.truncated, usage: usage ?? NO_USAGE, provider: "gemini", model: context.model }
      : { ...end, usage, provider: "gemini", model: context.model },
  };
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  label: "Google Gemini",
  keyVariable: "GEMINI_API_KEY",
  defaultModel: "gemini-2.5-flash-lite",
  generate,
  stream,
};

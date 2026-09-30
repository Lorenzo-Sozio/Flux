/**
 * What the copilot's tasks call: a task name and a request, never a vendor.
 *
 * ```ts
 * const result = await aiGenerate("summary", { system, messages, maxOutputTokens: 800 });
 * if (!result.ok) … // result.reason says why, in Flux's words
 * ```
 *
 * ⚠️ Server only: the key is read from the environment, and it must never reach a browser.
 */
import "server-only";

import { aiRoute } from "./config";
import type {
  AiFailure,
  AiProviderId,
  AiRequest,
  AiResult,
  AiStreamEvent,
  AiTask,
  AiUsage,
  FetchLike,
  JsonSchema,
} from "./types";

type Env = Record<string, string | undefined>;

export interface AiDeps {
  env?: Env;
  fetch?: FetchLike;
  /** Replaces the default timeout. */
  signal?: AbortSignal;
}

/** Past this, the call is abandoned and reported `unavailable`. A stream may run longer. */
const TIMEOUT_MS = { generate: 30_000, stream: 90_000 };

// ⚠️ Called through a closure: on Workers a detached `fetch` throws "Illegal invocation".
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function notAvailable(route: { state: "off" } | { state: "config"; problem: string }): AiFailure {
  return route.state === "off"
    ? { ok: false, reason: "off", message: "no AI provider is configured", usage: null, provider: null, model: null }
    : { ok: false, reason: "config", message: route.problem, usage: null, provider: null, model: null };
}

/** Whether a task can run here: the screens offer it only then. */
export function aiAvailable(task: AiTask, env: Env = process.env): boolean {
  return aiRoute(task, env).state === "on";
}

export async function aiGenerate(task: AiTask, request: AiRequest, deps: AiDeps = {}): Promise<AiResult> {
  const route = aiRoute(task, deps.env);
  if (route.state !== "on") return notAvailable(route);
  return route.provider.generate(request, {
    model: route.model,
    apiKey: route.apiKey,
    fetch: deps.fetch ?? defaultFetch,
    signal: deps.signal ?? AbortSignal.timeout(TIMEOUT_MS.generate),
  });
}

export async function* aiStream(task: AiTask, request: AiRequest, deps: AiDeps = {}): AsyncGenerator<AiStreamEvent> {
  const route = aiRoute(task, deps.env);
  if (route.state !== "on") {
    yield { type: "end", result: notAvailable(route) };
    return;
  }
  yield* route.provider.stream(request, {
    model: route.model,
    apiKey: route.apiKey,
    fetch: deps.fetch ?? defaultFetch,
    signal: deps.signal ?? AbortSignal.timeout(TIMEOUT_MS.stream),
  });
}

export type AiJsonResult<T> = { ok: true; value: T; usage: AiUsage; provider: AiProviderId; model: string } | AiFailure;

/**
 * An answer as structured data: the schema goes to the provider, and what comes back is parsed
 * and checked by `parse` — which returns null when the value does not fit, e.g. with Zod:
 * `(v) => { const r = schema.safeParse(v); return r.success ? r.data : null; }`.
 *
 * ⚠️ The provider's schema support is a promise, not a guarantee: every answer is checked here,
 * and one that does not fit is an `output` failure, never a value passed on half-right.
 */
export async function aiGenerateJson<T>(
  task: AiTask,
  request: Omit<AiRequest, "output"> & { schema: JsonSchema },
  parse: (value: unknown) => T | null,
  deps: AiDeps = {},
): Promise<AiJsonResult<T>> {
  const { schema, ...rest } = request;
  const result = await aiGenerate(task, { ...rest, output: { kind: "json", schema } }, deps);
  if (!result.ok) return result;

  const fail = (message: string): AiFailure => ({
    ok: false,
    reason: "output",
    message,
    usage: result.usage,
    provider: result.provider,
    model: result.model,
  });
  if (result.truncated) return fail("the answer was cut off at maxOutputTokens");
  let value: unknown;
  try {
    value = JSON.parse(result.text);
  } catch {
    return fail("the answer is not JSON");
  }
  const parsed = parse(value);
  if (parsed === null) return fail("the answer does not match the schema");
  return { ok: true, value: parsed, usage: result.usage, provider: result.provider, model: result.model };
}

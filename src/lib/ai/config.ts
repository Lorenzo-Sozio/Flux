/**
 * Which provider and which model answer each task — read from the environment, so changing the
 * model is a variable and not a release.
 *
 * ```
 * AI_PROVIDER=gemini                     # the provider for every task (default: gemini)
 * AI_MODEL=gemini-2.5-flash-lite         # its model (default: the provider's own)
 * GEMINI_API_KEY=…                       # the provider's key; without it the copilot is off
 * AI_MODEL_CLASSIFY=…                    # one task on another model of the same provider
 * AI_PROVIDER_DRAFT=… / AI_MODEL_DRAFT=… # one task on another provider altogether
 * ```
 *
 * ⚠️ `AI_MODEL` belongs to `AI_PROVIDER`: a task routed to a different provider does not inherit
 * it, because a model id means nothing to another vendor — it takes its own `AI_MODEL_<TASK>`
 * or that provider's default.
 *
 * ⚠️ Three states, and the difference between the first two matters. **off**: nothing is
 * configured, the copilot is simply not offered. **config**: something is configured and wrong
 * (an unknown provider, a named provider without its key, a malformed model id) — that is a
 * mistake by whoever operates the deployment, and saying "not available" would hide it.
 */
import { aiProvider, DEFAULT_AI_PROVIDER, isAiProviderId } from "./registry";
import type { AiProvider, AiTask } from "./types";

type Env = Record<string, string | undefined>;

/** A model id as providers write them. It goes into a URL path, so nothing else gets through. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;

export type AiRoute =
  | { state: "off" }
  | { state: "config"; problem: string }
  | { state: "on"; provider: AiProvider; model: string; apiKey: string };

function read(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

export function aiRoute(task: AiTask, env: Env = process.env): AiRoute {
  const suffix = task.toUpperCase();
  const taskProvider = read(env, `AI_PROVIDER_${suffix}`);
  const globalProvider = read(env, "AI_PROVIDER");
  const name = taskProvider ?? globalProvider ?? DEFAULT_AI_PROVIDER;
  if (!isAiProviderId(name)) return { state: "config", problem: `unknown AI provider "${name}"` };

  const provider = aiProvider(name);
  const apiKey = read(env, provider.keyVariable);
  if (!apiKey) {
    return taskProvider || globalProvider
      ? { state: "config", problem: `${provider.keyVariable} is not set` }
      : { state: "off" };
  }

  const inheritsGlobalModel = name === (globalProvider ?? DEFAULT_AI_PROVIDER);
  const model =
    read(env, `AI_MODEL_${suffix}`) ??
    (inheritsGlobalModel ? read(env, "AI_MODEL") : undefined) ??
    provider.defaultModel;
  if (!MODEL_ID.test(model)) return { state: "config", problem: `malformed model id "${model}"` };

  return { state: "on", provider, model, apiKey };
}

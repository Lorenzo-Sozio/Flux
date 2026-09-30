import { geminiProvider } from "./gemini";
import { AI_PROVIDER_IDS, type AiProvider, type AiProviderId } from "./types";

/**
 * The providers Flux can call. ⚠️ Adding one is a file implementing `AiProvider` (./types.ts)
 * and one line here: the routing (./config.ts) and every task read this list and nothing else.
 */
const PROVIDERS: Record<AiProviderId, AiProvider> = {
  gemini: geminiProvider,
};

/** The provider used when the configuration names none. */
export const DEFAULT_AI_PROVIDER: AiProviderId = "gemini";

export function aiProvider(id: AiProviderId): AiProvider {
  return PROVIDERS[id];
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

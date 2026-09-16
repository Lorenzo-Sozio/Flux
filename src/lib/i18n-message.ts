/**
 * i18n-message.ts — a message that is a translation key until somebody reads it.
 *
 * Validation runs in places that have no translator: Zod schemas shared by a
 * browser form and a server action, and the pure `clean*` functions that refuse a
 * contract, an invoice draft, a sequence or a territory. They used to write the
 * sentence themselves, in whichever language the author happened to think in, so
 * an Italian user read "First name is required." and an English one read "Serve
 * un titolo".
 *
 * They now write a key under the `validation` namespace, plus the values it needs,
 * and the component that shows it translates. Anything that is not such a key is
 * shown as it is, so a message written by a guard or by Next still reaches the
 * person unchanged.
 *
 * Pure module: imported by schemas, lib functions and client components alike.
 */

export type MessageParams = Record<string, string | number>;

/** A refusal from a `clean*` function: a key under `validation`, and its values. */
export interface Refusal {
  ok: false;
  error: string;
  params?: MessageParams;
}

const KEY = /^validation\.[\w.]+$/;

/** True when the string is a translation key rather than text to show as it is. */
export function isMessageKey(message: unknown): message is string {
  return typeof message === "string" && KEY.test(message);
}

/** Builds a refusal. `params` is omitted when there are none, so results compare cleanly. */
export function refuse(error: string, params?: MessageParams): Refusal {
  return params ? { ok: false, error, params } : { ok: false, error };
}

/** The translator a caller hands in: next-intl's root `t`, loosened to plain strings. */
export interface MessageTranslator {
  (key: string, values?: MessageParams): string;
  has(key: string): boolean;
}

/** Something that carries a message: a string, or a failed action result. */
export type MessageSource =
  | string
  | { error?: string | null; message?: string | null; params?: MessageParams }
  | null
  | undefined;

/**
 * The text to show for a message. A key the translator knows is translated; any
 * other string is returned unchanged; nothing at all becomes `fallback`.
 */
export function messageText(t: MessageTranslator, source: MessageSource, fallback = ""): string {
  const raw = typeof source === "string" ? source : (source?.message ?? source?.error);
  const params = typeof source === "object" && source ? source.params : undefined;
  if (!raw) return fallback;
  if (isMessageKey(raw) && t.has(raw)) return t(raw, params);
  return raw;
}

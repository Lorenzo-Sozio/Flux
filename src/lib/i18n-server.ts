/**
 * i18n-server.ts — the translator for messages a server writes for a person.
 *
 * A refusal returned by a server action or a route handler is read on somebody's
 * screen, so it follows their language like the rest of the interface. The locale
 * comes from the same place as every page (src/i18n/request.ts: cookie, then
 * Accept-Language, then the default).
 *
 * ⚠️ The guards that write these messages also run where there is no request to
 * read a locale from: inside `after()`, in a test, in a job. `getTranslations`
 * throws there, and a guard that throws *that* instead of its refusal would turn
 * "you are read-only" into a 500. So this never throws: without a request it
 * answers in English.
 */
import { createTranslator } from "next-intl";
import { getTranslations } from "next-intl/server";

import { type ActionResult, guarded, UNKNOWN_FALLBACK, VALIDATION_FALLBACK } from "@/lib/action-error";
import { isMessageKey } from "@/lib/i18n-message";

export type ServerValues = Record<string, string | number | Date>;

export interface ServerTranslator {
  (key: string, values?: ServerValues): string;
  has(key: string): boolean;
}

type Loose = {
  (key: string, values?: ServerValues): string;
  has(key: string): boolean;
};

/**
 * A translator for `namespace` (default `serverErrors`); pass `null` for the root.
 *
 *   const t = await serverT();
 *   return { ok: false, error: t("invoices.notFound") };
 */
export async function serverT(namespace: string | null = "serverErrors"): Promise<ServerTranslator> {
  try {
    const t = (await (namespace ? getTranslations(namespace) : getTranslations())) as unknown as Loose;
    return wrap(t);
  } catch {
    return englishT(namespace);
  }
}

async function englishT(namespace: string | null): Promise<ServerTranslator> {
  const messages = (await import("../../messages/en.json")).default as Record<string, unknown>;
  const t = createTranslator({
    locale: "en",
    messages,
    ...(namespace ? { namespace } : {}),
    // biome-ignore lint/suspicious/noEmptyBlockStatements: a missing key degrades to its name, below
    onError() {},
    getMessageFallback: ({ key }: { key: string }) => key.split(".").pop() ?? key,
  } as Parameters<typeof createTranslator>[0]) as unknown as Loose;
  return wrap(t);
}

function wrap(t: Loose): ServerTranslator {
  const fn = ((key: string, values?: ServerValues) => t(key, values)) as ServerTranslator;
  fn.has = (key: string) => t.has(key);
  return fn;
}

/**
 * `guarded()` with its own fallbacks in the reader's language.
 *
 * `toActionFailure` lives in a pure module the browser imports, so it cannot reach
 * a translator and writes its two generic sentences in English. This swaps them,
 * and translates a `validation.*` key a Zod schema wrote, so a component that
 * shows `result.message` as it is still shows a sentence.
 */
export async function guardedT<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  const result = await guarded(fn);
  if (result.ok) return result;

  if (result.message === UNKNOWN_FALLBACK || result.message === VALIDATION_FALLBACK) {
    const t = await serverT();
    return { ...result, message: t(result.message === UNKNOWN_FALLBACK ? "generic.unknown" : "generic.validation") };
  }
  if (isMessageKey(result.message)) {
    const t = await serverT(null);
    if (t.has(result.message)) return { ...result, message: t(result.message) };
  }
  return result;
}

import { cookies, headers } from "next/headers";

import { getRequestConfig } from "next-intl/server";

import { defaultLocale, LOCALE_COOKIE, type Locale, locales } from "./config";

/**
 * Picks the locale for the request.
 *
 * Two things were missing (audit rilievi U-07, U-08):
 *
 *  • No fallback. The Italian file was 56 keys behind the English one and
 *    next-intl renders the key path when a message is absent, so an Italian user
 *    read `marketing.campaigns.launch.title` in the dialog that sends a campaign
 *    to their whole list. The files are in sync again, but a fallback means the
 *    next gap degrades to English rather than to raw key paths.
 *
 *  • No detection. The cookie was the only signal and the default was English, so
 *    an Italian visitor opening the product for the first time — in a product
 *    whose own copy is largely Italian — got English until they found the switch.
 */
function pickFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number.parseFloat(q.split("=")[1]) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    const match = locales.find((l) => l === tag || l === base);
    if (match) return match;
  }

  return null;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale: Locale;
  if (locales.includes(raw as Locale)) {
    // An explicit choice always wins.
    locale = raw as Locale;
  } else {
    const headerList = await headers().catch(() => null);
    locale = pickFromAcceptLanguage(headerList?.get("accept-language") ?? null) ?? defaultLocale;
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;

  // A missing message falls back to the default locale instead of rendering the
  // key path to the user.
  const fallback = locale === defaultLocale ? messages : (await import(`../../messages/${defaultLocale}.json`)).default;

  return {
    locale,
    messages: locale === defaultLocale ? messages : deepMerge(fallback, messages),
    // Keep the page rendering when a key is absent from BOTH files. next-intl's
    // default is to throw in development and log in production; neither helps the
    // person looking at the screen, and the fallback below already degrades to
    // something readable.
    // biome-ignore lint/suspicious/noEmptyBlockStatements: swallowing is the behaviour
    onError() {},
    getMessageFallback({ key }: { key: string }) {
      return key.split(".").pop() ?? key;
    },
  };
});

/** Overlays `override` on `base`, so an untranslated branch keeps the fallback text. */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (value && typeof value === "object" && !Array.isArray(value) && existing && typeof existing === "object") {
      out[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }

  return out;
}

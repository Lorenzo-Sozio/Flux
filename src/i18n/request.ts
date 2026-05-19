import { cookies } from "next/headers";

import { getRequestConfig } from "next-intl/server";

import { defaultLocale, LOCALE_COOKIE, type Locale, locales } from "./config";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = locales.includes(raw as Locale) ? (raw as Locale) : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

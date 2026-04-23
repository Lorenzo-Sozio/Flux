"use server";

import { cookies } from "next/headers";
import { locales, LOCALE_COOKIE, defaultLocale, type Locale } from "@/i18n/config";

export async function setLocale(locale: string): Promise<void> {
  const safe: Locale = locales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, safe, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
}

export async function getLocaleFromCookie(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  return locales.includes(raw as Locale) ? (raw as Locale) : defaultLocale;
}

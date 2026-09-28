import { createTranslator } from "next-intl";

import type en from "../../messages/en.json";

/** A notification the product composes itself: a `notificationTexts` entry. */
export type NotificationKey = keyof (typeof en)["notificationTexts"];
export type NotificationParams = Record<string, string | number>;
export type NotificationLocale = "en" | "it";

/** A stored locale, if it is one the notifications are written in. */
export function notificationLocale(value: string | null | undefined): NotificationLocale | null {
  return value === "it" || value === "en" ? value : null;
}

/**
 * The text of a notification in the default locale, as it is stored and pushed.
 *
 * ⚠️⚠️ Notifications were finished English sentences written inside the code — "Task due
 * today", "SLA missed", "Upcoming appointment" — in a product most of whose people read
 * Italian, and the translation check never saw them because they live in the database, not
 * in a component. The row now keeps the key and the values too, and the bell composes them
 * in the reader's language (src/components/notifications/notification-center.tsx). What is
 * stored is English, the fallback; a push is composed again in the recipient's language
 * (src/lib/push-send.ts), which is what `locale` is for.
 *
 * ⚠️ Deterministic for the same key and values — two jobs recognise a reminder they have
 * already sent today by the stored title, so what is stored stays in English.
 */
export async function composeNotification(
  key: NotificationKey,
  params: NotificationParams = {},
  locale: NotificationLocale = "en",
): Promise<{ title: string; message: string }> {
  const messages =
    locale === "it"
      ? (await import("../../messages/it.json")).default
      : (await import("../../messages/en.json")).default;
  const t = createTranslator({
    locale,
    messages,
    namespace: "notificationTexts",
    // biome-ignore lint/suspicious/noEmptyBlockStatements: a missing value degrades to its name
    onError() {},
    getMessageFallback: ({ key: k }: { key: string }) => k.split(".").pop() ?? k,
  } as Parameters<typeof createTranslator>[0]) as unknown as (k: string, v?: NotificationParams) => string;
  return { title: t(`${key}.title`, params), message: t(`${key}.message`, params) };
}

import { createTranslator } from "next-intl";

import type en from "../../messages/en.json";

/** A notification the product composes itself: a `notificationTexts` entry. */
export type NotificationKey = keyof (typeof en)["notificationTexts"];
export type NotificationParams = Record<string, string | number>;

/**
 * The text of a notification in the default locale, as it is stored and pushed.
 *
 * ⚠️⚠️ Notifications were finished English sentences written inside the code — "Task due
 * today", "SLA missed", "Upcoming appointment" — in a product most of whose people read
 * Italian, and the translation check never saw them because they live in the database, not
 * in a component. The row now keeps the key and the values too, and the bell composes them
 * in the reader's language (src/components/notifications/notification-center.tsx). This is
 * the fallback: what a push carries, since the job sending it knows no reader's locale.
 *
 * Deterministic for the same key and values — two jobs rely on that to recognise a reminder
 * they have already sent today.
 */
export async function composeNotification(
  key: NotificationKey,
  params: NotificationParams = {},
): Promise<{ title: string; message: string }> {
  const messages = (await import("../../messages/en.json")).default;
  const t = createTranslator({
    locale: "en",
    messages,
    namespace: "notificationTexts",
    // biome-ignore lint/suspicious/noEmptyBlockStatements: a missing value degrades to its name
    onError() {},
    getMessageFallback: ({ key: k }: { key: string }) => k.split(".").pop() ?? k,
  } as Parameters<typeof createTranslator>[0]) as unknown as (k: string, v?: NotificationParams) => string;
  return { title: t(`${key}.title`, params), message: t(`${key}.message`, params) };
}

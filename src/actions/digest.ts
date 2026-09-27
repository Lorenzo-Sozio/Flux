"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { notificationPreferences } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { rememberLocale } from "@/lib/morning-digest";
import { getDb } from "@/lib/tenant-context";

/** Whether this person receives the morning digest. Personal: every role, their own row. */
export async function getDigestPreference(): Promise<boolean> {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  const [row] = await db
    .select({ on: notificationPreferences.digestEmail })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, actor.userId))
    .catch(() => []);
  return row?.on ?? true;
}

export async function setDigestPreferenceAction(on: boolean, locale?: string): Promise<void> {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  await db
    .insert(notificationPreferences)
    .values({ userId: actor.userId, digestEmail: on === true })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { digestEmail: on === true } });
  // The language the email will be written in: the one this page is being read in.
  if (locale) await rememberLocale(db, actor.userId, locale);
  revalidatePath("/dashboard/settings/notifications");
}

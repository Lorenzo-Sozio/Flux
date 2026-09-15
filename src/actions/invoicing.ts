"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { invoiceIssuers } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { type Gap, issuerGaps } from "@/lib/fiscal-ids";
import { cleanIssuer, type IssuerInput } from "@/lib/invoice-issuer";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

const ROW = "workspace";

export type IssuerProfileRow = typeof invoiceIssuers.$inferSelect;

/** The issuer profile and what still stops an invoice, for anyone who can see records. */
export async function getIssuerProfile(): Promise<{ profile: IssuerProfileRow | null; gaps: Gap[] }> {
  await requireCapability("record:read");
  const db = await getDb();
  const [profile] = await tolerateUnmigrated(
    "invoice_issuer",
    () => db.select().from(invoiceIssuers).where(eq(invoiceIssuers.id, ROW)),
    [],
  );
  return { profile: profile ?? null, gaps: issuerGaps(profile ?? {}) };
}

/**
 * Saves the profile, complete or not, and says what is still missing.
 *
 * ⚠️ An incomplete profile is saved rather than refused: it is typed over days,
 * from documents found one at a time. What it may not do is issue an invoice,
 * and that is decided where invoices are issued.
 */
export async function saveIssuerProfile(input: IssuerInput): Promise<{ ok: true; gaps: Gap[] }> {
  const actor = await requireCapability("invoicing:manage");
  const values = cleanIssuer(input);
  const db = await getDb();
  await db
    .insert(invoiceIssuers)
    .values({ id: ROW, ...values, updatedBy: actor.userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: invoiceIssuers.id,
      set: { ...values, updatedBy: actor.userId, updatedAt: new Date() },
    });
  revalidatePath("/dashboard/settings/invoicing");
  return { ok: true, gaps: issuerGaps(values) };
}

"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { createTenantDb, platformDb } from "@/db";
import { tenantMembers, users } from "@/db/schema";
import { getAppUrlOrNull } from "@/lib/app-url";
import { requireCapability } from "@/lib/auth-guard";
import { type BookingSettings, cleanBookingSettings, ensureBookingLink, saveBookingSettings } from "@/lib/booking";
import { getTenantById } from "@/lib/get-tenant";
import { inboundEmailConfigured } from "@/lib/inbound-sales-reply";
import { archiveAddress, archiveDomain, ensureArchiveToken, rotateArchiveToken } from "@/lib/mail-archive";
import { can } from "@/lib/permissions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * The signed-in person's own account: what the profile page shows and changes.
 *
 * ⚠️ Anybody in a workspace, whatever their role. Changing one's own password was only
 * reachable from /dashboard/users, which is for administrators, so an editor or a viewer
 * had no way to do it at all — and the account menu offered a "Profile" with no page.
 */

// Not exported: a "use server" module may export async functions only.
const MAX_NAME_LENGTH = 120;

export async function getOwnProfile(): Promise<{ name: string; email: string; hasPassword: boolean }> {
  const actor = await requireCapability("record:read");
  const [account] = await platformDb
    .select({ name: users.name, email: users.email, password: users.password })
    .from(users)
    .where(eq(users.id, actor.userId));
  return { name: account?.name ?? "", email: account?.email ?? "", hasPassword: Boolean(account?.password) };
}

/**
 * The person's name, on their account and in every workspace they belong to.
 *
 * ⚠️ Each workspace keeps its own copy of its members (the owner column of every record
 * points at it, and lists read the name from there), so the account alone is not enough:
 * the old name would go on showing beside every deal they own. Copies in other workspaces
 * are best-effort — a workspace whose database cannot be reached keeps the old name until
 * the next membership sync, and this one still succeeds.
 */
export async function updateOwnNameAction(
  name: string,
): Promise<{ ok: true } | { ok: false; reason: "empty" | "tooLong" }> {
  const actor = await requireCapability("record:read");
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return { ok: false, reason: "empty" };
  if (clean.length > MAX_NAME_LENGTH) return { ok: false, reason: "tooLong" };

  await platformDb.update(users).set({ name: clean }).where(eq(users.id, actor.userId));

  const memberships = await platformDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, actor.userId));
  await Promise.all(
    memberships.map(async ({ tenantId }) => {
      try {
        const tenant = await getTenantById(tenantId);
        if (!tenant?.dbUrl) return;
        await createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl))
          .update(users)
          .set({ name: clean })
          .where(eq(users.id, actor.userId));
      } catch (err) {
        console.error(`[updateOwnNameAction] workspace ${tenantId} keeps the old name for now:`, err);
      }
    }),
  );

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export type ArchiveAddressState =
  | { status: "ready"; address: string }
  | { status: "unavailable"; reason: "notConfigured" | "readOnly" };

/**
 * This person's Bcc archive address (src/lib/mail-archive.ts), created the first time the
 * page asks for it.
 *
 * ⚠️ Said plainly when it cannot work: with no archive domain, or no inbound webhook to
 * deliver to, an address would reach nowhere and archive nothing while looking like it did.
 * A viewer gets none — filing email is writing to the records.
 */
export async function getOwnArchiveAddress(): Promise<ArchiveAddressState> {
  const actor = await requireCapability("record:read");
  if (!can(actor, "record:write")) return { status: "unavailable", reason: "readOnly" };
  const domain = archiveDomain();
  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  if (!domain || !inboundEmailConfigured() || !tenant?.subdomain) {
    return { status: "unavailable", reason: "notConfigured" };
  }
  const token = await ensureArchiveToken(await getDb(), actor.userId);
  return { status: "ready", address: archiveAddress(tenant.subdomain, token, domain) };
}

/** A new address; the old one stops filing at once. For one that was shared by mistake. */
export async function rotateArchiveAddressAction(): Promise<ArchiveAddressState> {
  const actor = await requireCapability("record:write");
  await rotateArchiveToken(await getDb(), actor.userId);
  return getOwnArchiveAddress();
}

export type BookingLinkState =
  | { status: "ready"; address: string | null; settings: BookingSettings }
  | { status: "unavailable"; reason: "readOnly" | "notConfigured" };

/**
 * This person's public booking page (src/lib/booking.ts), created closed the first time.
 * A viewer gets none: a booking writes an appointment and, for a stranger, a lead.
 */
export async function getOwnBookingLink(): Promise<BookingLinkState> {
  const actor = await requireCapability("record:read");
  if (!can(actor, "record:write")) return { status: "unavailable", reason: "readOnly" };
  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  if (!tenant?.subdomain) return { status: "unavailable", reason: "notConfigured" };
  const link = await ensureBookingLink(await getDb(), actor.userId);
  const base = getAppUrlOrNull();
  return {
    status: "ready",
    // No address without a public origin to put in front of it: a relative one is not a link.
    address: base ? `${base}/b/${tenant.subdomain}/${link.token}` : null,
    settings: {
      enabled: link.enabled,
      title: link.title ?? "",
      durationMinutes: link.durationMinutes,
      daysAhead: link.daysAhead,
      dayStart: link.dayStart,
      dayEnd: link.dayEnd,
      weekdays: link.weekdays,
      bufferMinutes: link.bufferMinutes,
    },
  };
}

export async function saveBookingLinkAction(
  input: Partial<Record<keyof BookingSettings, unknown>>,
): Promise<{ ok: true; state: BookingLinkState } | { ok: false }> {
  const actor = await requireCapability("record:write");
  const settings = cleanBookingSettings(input);
  if (!settings) return { ok: false };
  await saveBookingSettings(await getDb(), actor.userId, settings);
  return { ok: true, state: await getOwnBookingLink() };
}

import "server-only";

import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { dispatchInvites } from "@/lib/appointment-invites";
import {
  type BookingLink,
  type BookingResult,
  bookingLinkByToken,
  bookSlot,
  openSlots,
  type Visitor,
} from "@/lib/booking";
import { notify } from "@/lib/notify";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveTenantBySubdomain, type TenantDb } from "@/lib/tenant-resolve";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

/**
 * The booking page and its form, for a visitor with no session (src/lib/booking.ts).
 *
 * ⚠️⚠️ Everything runs inside `runWithTenant`. The workspace's time zone is read through
 * the request's workspace, and outside one it falls back to Rome without a word — a New
 * York workspace would offer Rome's hours, and book them. The workspace comes from the
 * address (its subdomain), never from anything the visitor could set.
 */

interface Resolved {
  tenantId: string;
  db: TenantDb;
  link: BookingLink;
  ownerName: string;
}

async function resolve(workspace: string, token: string): Promise<Resolved | null> {
  const found = await resolveTenantBySubdomain(workspace);
  if (!found) return null;
  const link = await bookingLinkByToken(found.db, token).catch(() => null);
  if (!link?.enabled) return null;
  const [owner] = await found.db.select({ name: users.name }).from(users).where(eq(users.id, link.userId));
  return { tenantId: found.tenant.id, db: found.db, link, ownerName: owner?.name ?? "" };
}

export interface BookingPage {
  ownerName: string;
  title: string | null;
  durationMinutes: number;
  timeZone: string;
  /** ISO instants. */
  slots: string[];
}

export async function loadBookingPage(workspace: string, token: string): Promise<BookingPage | null> {
  const r = await resolve(workspace, token);
  if (!r) return null;
  return runWithTenant(r.tenantId, async () => {
    const timeZone = await getWorkspaceTimeZone();
    const slots = await openSlots(r.db, r.link, timeZone);
    return {
      ownerName: r.ownerName,
      title: r.link.title,
      durationMinutes: r.link.durationMinutes,
      timeZone,
      slots: slots.map((s) => s.toISOString()),
    };
  });
}

export async function submitBooking(
  workspace: string,
  token: string,
  start: Date,
  visitor: Visitor,
  defaultTitle: string,
): Promise<BookingResult | { ok: false; reason: "notFound" }> {
  const r = await resolve(workspace, token);
  if (!r) return { ok: false, reason: "notFound" };
  return runWithTenant(r.tenantId, async () => {
    const zone = await getWorkspaceTimeZone();
    const result = await bookSlot(r.db, r.link, { start, visitor, zone, defaultTitle });
    if (!result.ok) return result;
    // The calendar invitation to the visitor, and a word to the owner. Neither may fail
    // the booking, which is already written.
    await dispatchInvites(result.appointmentId, "REQUEST").catch((err) =>
      console.error("[booking] booked, invitation not sent:", err),
    );
    await notify({
      userId: r.link.userId,
      type: "booking_received",
      key: "bookingReceived",
      // Numeric, on the workspace's clock: it reads the same in either language.
      params: {
        who: visitor.name,
        when: new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "short", timeStyle: "short" }).format(
          start,
        ),
      },
      link: `/dashboard/calendar?appointment=${result.appointmentId}`,
    }).catch((err) => console.error("[booking] booked, owner not told:", err));
    return result;
  });
}

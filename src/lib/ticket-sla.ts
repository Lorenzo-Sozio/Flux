import { and, eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { slas } from "@/db/schema";
import { loadBusinessCalendar } from "@/lib/business-calendar";
import { addBusinessMinutes } from "@/lib/business-hours";
import { tolerateUnmigrated } from "@/lib/schema-ready";

// biome-ignore lint/suspicious/noExplicitAny: platform and tenant handles share the query builders
type AnyDb = NeonHttpDatabase<any>;

export interface TicketSla {
  slaId: string | null;
  firstResponseDueAt: Date | null;
  slaDeadlineAt: Date | null;
}

/**
 * Picks the SLA policy that applies to a ticket, and works out both deadlines.
 *
 * Ticket creation called `calculateSLADeadline(null)` — the argument was hardcoded
 * — so `slaDeadlineAt` was always empty and no ticket ever carried an SLA at all.
 * The policy page, the compliance gauge, the "SLA due" badge and the breach job
 * were therefore all reading a column nothing wrote (audit rilievo D-01).
 *
 * ⚠️⚠️ **It takes the database, and every way a ticket is born calls it.** It used to
 * live in the dashboard's actions and read the workspace from the request, so the
 * tickets that arrive by email or through a web form — which have no request to read
 * it from — were created with no policy at all: no deadline, no breach, and nothing
 * to measure an agent against. Those are most tickets.
 *
 * The policy is matched on priority, which is what the `sla.priority` column is
 * for. A ticket whose priority has no policy simply has no deadline, rather than
 * silently inheriting someone else's.
 */
export async function resolveSla(db: AnyDb, priority: string, from: Date = new Date()): Promise<TicketSla> {
  // ⚠️⚠️ **Only the columns this needs, named.** `findFirst` selects every column
  // the schema declares, including ones a migration has not created yet. The
  // working-hours switch arrived with migration 0007, so it is asked for first and
  // dropped on the one workspace-shaped error that means "not yet".
  const where = and(eq(slas.priority, priority), eq(slas.isActive, true));

  const row = await tolerateUnmigrated(
    "SLA working hours",
    async () => {
      const [full] = await db
        .select({
          id: slas.id,
          firstResponseTimeMinutes: slas.firstResponseTimeMinutes,
          resolutionTimeMinutes: slas.resolutionTimeMinutes,
          useBusinessHours: slas.useBusinessHours,
        })
        .from(slas)
        .where(where)
        .limit(1);
      return full ?? null;
    },
    null,
  );

  const sla =
    row ??
    (await (async () => {
      const [base] = await db
        .select({
          id: slas.id,
          firstResponseTimeMinutes: slas.firstResponseTimeMinutes,
          resolutionTimeMinutes: slas.resolutionTimeMinutes,
        })
        .from(slas)
        .where(where)
        .limit(1);
      return base ? { ...base, useBusinessHours: false } : null;
    })());

  if (!sla) return { slaId: null, firstResponseDueAt: null, slaDeadlineAt: null };

  // A policy measured in working minutes needs the workspace's own week. Wall
  // clock stays the default on existing policies, so nothing already promised
  // changes meaning without somebody choosing it (audit rilievo S-07).
  const advance = sla.useBusinessHours
    ? await (async () => {
        const calendar = await loadBusinessCalendar(db);
        return (minutes: number) => addBusinessMinutes(from, minutes, calendar);
      })()
    : (minutes: number) => new Date(from.getTime() + minutes * 60_000);

  return {
    slaId: sla.id,
    // Two promises, tracked separately. The ticket only ever had one field, so
    // first-response compliance could not be measured even in principle.
    firstResponseDueAt: advance(sla.firstResponseTimeMinutes),
    slaDeadlineAt: advance(sla.resolutionTimeMinutes),
  };
}

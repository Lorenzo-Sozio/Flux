import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { tickets } from "@/db/schema";
import { runCronJob } from "@/lib/cron-runner";

const OPEN_STATUSES = ["new", "open", "in_progress"];

/**
 * Flags tickets that have passed their SLA deadline, in every workspace.
 *
 * This job could never have found anything even when it ran: tickets were created
 * with `calculateSLADeadline(null)`, so `slaDeadlineAt` was always empty (audit
 * rilievo D-01). That is fixed at ticket creation; this route only had to stop
 * resolving a single tenant from a header it never receives (rilievo B-02).
 */
export async function GET(req: Request) {
  return runCronJob("ticket-sla-check", req, async (db) => {
    const now = new Date();

    // Tickets past their deadline that have not been flagged yet
    const candidates = await db.query.tickets.findMany({
      where: and(isNotNull(tickets.slaDeadlineAt), isNull(tickets.slaBreachedAt), lt(tickets.slaDeadlineAt, now)),
    });

    // Exclude tickets whose SLA clock is paused (waiting on the customer)
    const active = candidates.filter((t) => OPEN_STATUSES.includes(t.status) && !t.slaPausedAt);

    if (active.length === 0) return { breached: 0 };

    await Promise.all(
      active.map((t) => db.update(tickets).set({ slaBreachedAt: now, updatedAt: now }).where(eq(tickets.id, t.id))),
    );

    // Awaited rather than fire-and-forget: on Workers a promise still running after
    // the response is killed, and the escalation would simply not happen.
    await Promise.allSettled(
      active.map((t) =>
        runAutomations({
          entityType: "ticket",
          entityId: t.id,
          event: "onSLABreach",
          oldData: t as Record<string, unknown>,
          newData: { ...t, slaBreachedAt: now } as Record<string, unknown>,
        }),
      ),
    );

    return { breached: active.length };
  });
}

import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";

import { createNotificationsBatch } from "@/actions/auth";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import { slas, tickets, userGroupMembers } from "@/db/schema";
import { runCronJob } from "@/lib/cron-runner";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import type { getDb } from "@/lib/tenant-context";

const OPEN_STATUSES = ["new", "open", "in_progress"];

/**
 * The two thresholds a team can still act on.
 *
 * Being told at the moment of breach is being told too late: the promise is
 * already broken and nothing about the message helps (audit rilievo S-07). These
 * are fractions of the window consumed, so they mean the same thing whether the
 * policy is four hours or two days.
 */
const WARN_AT = [
  { level: 80, consumed: 0.8, label: "80%" },
  { level: 50, consumed: 0.5, label: "50%" },
];

/**
 * Who else hears about a policy being missed, by policy.
 *
 * The remedy asked for escalation to a manager and the schema has no hierarchy,
 * so the policy names a **group** instead: a support team already exists as one,
 * and nobody has to keep an org chart true for the escalation to work (audit
 * rilievo S-07). A policy with no group chosen returns nobody, which is the
 * behaviour every workspace has today.
 */
async function escalationByPolicy(
  db: Awaited<ReturnType<typeof getDb>>,
  slaIds: (string | null)[],
): Promise<Map<string, string[]>> {
  const ids = [...new Set(slaIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  // The escalation group arrived in migration 0009, and a tenant database is
  // migrated by hand days after the deploy. Until then nobody is escalated to,
  // which is what every workspace had before this existed — rather than the job
  // failing outright and no breach being flagged at all.
  const policies = await tolerateUnmigrated(
    "SLA escalation groups",
    () => db.select({ id: slas.id, groupId: slas.escalationGroupId }).from(slas).where(inArray(slas.id, ids)),
    [] as { id: string; groupId: string | null }[],
  );

  const groupIds = [...new Set(policies.map((p) => p.groupId).filter((g): g is string => Boolean(g)))];
  if (groupIds.length === 0) return new Map();

  const members = await db
    .select({ groupId: userGroupMembers.groupId, userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(inArray(userGroupMembers.groupId, groupIds));

  const byGroup = new Map<string, string[]>();
  for (const m of members) byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m.userId]);

  const byPolicy = new Map<string, string[]>();
  for (const p of policies) {
    if (p.groupId) byPolicy.set(p.id, byGroup.get(p.groupId) ?? []);
  }
  return byPolicy;
}

/**
 * Flags tickets that have passed their SLA deadline, and warns about the ones
 * approaching it, in every workspace.
 *
 * This job could never have found anything even when it ran: tickets were created
 * with `calculateSLADeadline(null)`, so `slaDeadlineAt` was always empty (audit
 * rilievo D-01). That is fixed at ticket creation; this route also had to stop
 * resolving a single tenant from a header it never receives (rilievo B-02).
 */
export async function GET(req: Request) {
  return runCronJob("ticket-sla-check", req, async (db) => {
    const now = new Date();

    // ── Already past the deadline ────────────────────────────────────────────
    // ⚠️ Named columns, not `findMany`. The relational query selects everything
    // the schema declares, which includes `sla_warn_level` from migration 0007 —
    // so on a workspace that has not been migrated yet this whole job threw, and
    // nothing was flagged or warned about. Flagging a breach never needed that
    // column, so it no longer asks for it.
    const candidates = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        slaId: tickets.slaId,
        assigneeId: tickets.assigneeId,
        ownerId: tickets.ownerId,
        slaPausedAt: tickets.slaPausedAt,
        slaDeadlineAt: tickets.slaDeadlineAt,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(and(isNotNull(tickets.slaDeadlineAt), isNull(tickets.slaBreachedAt), lt(tickets.slaDeadlineAt, now)));

    // Exclude tickets whose SLA clock is paused (waiting on the customer)
    const active = candidates.filter((t) => OPEN_STATUSES.includes(t.status) && !t.slaPausedAt);

    if (active.length > 0) {
      await Promise.all(
        active.map((t) => db.update(tickets).set({ slaBreachedAt: now, updatedAt: now }).where(eq(tickets.id, t.id))),
      );

      // Awaited rather than fire-and-forget: on Workers a promise still running
      // after the response is killed, and the escalation would simply not happen.
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

      // A breach used to set a column and run whatever rules the workspace had
      // written, which for most workspaces is none: the promise was missed and
      // nobody was told. Now the person holding it hears, and so does the group
      // the policy escalates to, each of them once (rilievo S-07).
      const escalation = await escalationByPolicy(
        db,
        active.map((t) => t.slaId),
      );

      const breachRows = active.flatMap((t) => {
        const recipients = new Set<string>();
        const holder = t.assigneeId ?? t.ownerId;
        if (holder) recipients.add(holder);
        for (const userId of escalation.get(t.slaId ?? "") ?? []) recipients.add(userId);
        return [...recipients].map((userId) => ({
          userId,
          type: "sla_breach",
          title: `SLA missed — ${t.ticketNumber}`,
          message: t.subject,
          link: `/dashboard/support/tickets/${t.id}`,
        }));
      });

      if (breachRows.length > 0) await createNotificationsBatch(breachRows).catch(() => undefined);
    }

    // ── Approaching the deadline ─────────────────────────────────────────────
    //
    // The fraction consumed is measured against the ticket's own window, from
    // when it arrived to when it was promised, so a four-hour policy and a
    // two-day one warn at the same point in their own terms.
    // The warning pass is the one that genuinely needs migration 0007, so it is
    // the only part that stands down when the column is absent.
    const live = await tolerateUnmigrated(
      "SLA warning thresholds",
      () =>
        db
          .select({
            id: tickets.id,
            ticketNumber: tickets.ticketNumber,
            subject: tickets.subject,
            status: tickets.status,
            slaId: tickets.slaId,
            assigneeId: tickets.assigneeId,
            ownerId: tickets.ownerId,
            slaPausedAt: tickets.slaPausedAt,
            slaDeadlineAt: tickets.slaDeadlineAt,
            createdAt: tickets.createdAt,
            slaWarnLevel: tickets.slaWarnLevel,
          })
          .from(tickets)
          .where(and(isNotNull(tickets.slaDeadlineAt), isNull(tickets.slaBreachedAt))),
      [] as {
        id: string;
        ticketNumber: string;
        subject: string;
        status: string;
        slaId: string | null;
        assigneeId: string | null;
        ownerId: string | null;
        slaPausedAt: Date | null;
        slaDeadlineAt: Date | null;
        createdAt: Date;
        slaWarnLevel: number;
      }[],
    );

    const warnings: { ticket: (typeof live)[number]; level: number; label: string }[] = [];

    for (const ticket of live) {
      if (!ticket.slaDeadlineAt) continue;
      if (!OPEN_STATUSES.includes(ticket.status) || ticket.slaPausedAt) continue;

      const total = ticket.slaDeadlineAt.getTime() - ticket.createdAt.getTime();
      if (total <= 0) continue;
      const consumed = (now.getTime() - ticket.createdAt.getTime()) / total;

      // The highest threshold crossed, so a ticket that goes quiet for an hour
      // gets the 80% warning rather than two messages in a row.
      const reached = WARN_AT.find((w) => consumed >= w.consumed);
      if (reached && ticket.slaWarnLevel < reached.level) {
        warnings.push({ ticket, level: reached.level, label: reached.label });
      }
    }

    if (warnings.length > 0) {
      await Promise.all(
        warnings.map((w) =>
          db.update(tickets).set({ slaWarnLevel: w.level, updatedAt: now }).where(eq(tickets.id, w.ticket.id)),
        ),
      );

      // Whoever is holding it, and when nobody is, the group the policy escalates
      // to. A ticket nobody owns used to be a ticket nobody was warned about,
      // which is the one most likely to run out of time (rilievo S-07).
      const warnEscalation = await escalationByPolicy(
        db,
        warnings.map((w) => w.ticket.slaId),
      );

      const rows = warnings.flatMap((w) => {
        const holder = w.ticket.assigneeId ?? w.ticket.ownerId;
        const recipients = holder ? [holder] : (warnEscalation.get(w.ticket.slaId ?? "") ?? []);
        return recipients.map((userId) => ({
          userId,
          type: "sla_warning",
          title: `${w.label} of the SLA used — ${w.ticket.ticketNumber}`,
          message: w.ticket.subject,
          link: `/dashboard/support/tickets/${w.ticket.id}`,
        }));
      });

      if (rows.length > 0) await createNotificationsBatch(rows).catch(() => undefined);
    }

    return { breached: active.length, warned: warnings.length };
  });
}

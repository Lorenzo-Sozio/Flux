"use server";

import { and, desc, eq, gt, inArray, isNotNull, isNull, like, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";

import { activities, companies, deals, leads, nextActionSnoozes, quotes, tasks, tickets } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { dealSignals, lastActivityByDeal, nextStepByDeal } from "@/lib/deal-signals";
import { REPLY_TASK_PREFIX } from "@/lib/inbound-sales-reply";
import {
  buildWorkList,
  daysBetween,
  leadScoreWeight,
  type NextAction,
  slaRemainingFraction,
  THRESHOLDS,
  urgencyOf,
  withoutSnoozed,
} from "@/lib/next-actions";
import { type ReachKey, reachFor } from "@/lib/record-reach";
import { getDb } from "@/lib/tenant-context";

const DAY_MS = 86_400_000;

/** Everything that is not an answer yet. */
const OPEN_TICKET_STATES = ["resolved", "closed"];

/**
 * The work list: what needs doing now, drawn from data already in the schema.
 *
 * Scoped to the person asking. A shared list is a list nobody owns, and the whole
 * point is that opening the CRM answers "what am I meant to do today" without
 * anybody having to read six screens and work it out (audit rilievo S-02).
 *
 * Each rule is a small, indexed query with its own cap, so the cost is bounded
 * however large the workspace grows.
 */
export async function getNextActions(limit = 12): Promise<NextAction[]> {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  const now = Date.now();
  const mine = actor.userId;

  const lastActivity = lastActivityByDeal(db, new Date(now));
  const nextStep = nextStepByDeal(db, new Date(now));

  const leadCutoff = new Date(now - THRESHOLDS.leadUntouchedDays * DAY_MS);
  const quietCutoff = new Date(now - THRESHOLDS.customerQuietDays * DAY_MS);
  const companyLastActivity = db
    .select({
      companyId: activities.companyId,
      last: sql<Date>`max(${activities.createdAt})`.as("company_last"),
    })
    .from(activities)
    .where(isNotNull(activities.companyId))
    .groupBy(activities.companyId)
    .as("company_last_activity");

  // Seven independent reads, started together: they used to run one after another, and the
  // home page waited for all seven in turn before it could draw its first card.
  const [liveTickets, liveQuotes, openDeals, coldLeads, quietCustomers, replies, snoozes] = await Promise.all([
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        createdAt: tickets.createdAt,
        slaDeadlineAt: tickets.slaDeadlineAt,
        slaBreachedAt: tickets.slaBreachedAt,
      })
      .from(tickets)
      .where(
        and(
          notInArray(tickets.status, OPEN_TICKET_STATES),
          isNotNull(tickets.slaDeadlineAt),
          or(eq(tickets.assigneeId, mine), eq(tickets.ownerId, mine)),
        ),
      )
      .orderBy(tickets.slaDeadlineAt)
      .limit(50),
    db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        status: quotes.status,
        sentAt: quotes.sentAt,
        viewedAt: quotes.viewedAt,
        expiresAt: quotes.expiresAt,
        totalAmount: quotes.totalAmount,
        acceptedAt: quotes.acceptedAt,
        dealId: quotes.dealId,
      })
      .from(quotes)
      .where(and(inArray(quotes.status, ["sent", "viewed", "accepted"]), eq(quotes.ownerId, mine)))
      .orderBy(desc(quotes.sentAt))
      .limit(50),
    db
      .select({
        id: deals.id,
        name: deals.name,
        createdAt: deals.createdAt,
        expectedCloseDate: deals.expectedCloseDate,
        lastTouched: lastActivity.at,
        steps: nextStep.n,
      })
      .from(deals)
      .leftJoin(lastActivity, eq(lastActivity.dealId, deals.id))
      .leftJoin(nextStep, eq(nextStep.dealId, deals.id))
      .where(and(eq(deals.status, "open"), eq(deals.ownerId, mine)))
      .limit(100),
    db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        companyName: leads.companyName,
        createdAt: leads.createdAt,
        leadScore: leads.leadScore,
      })
      .from(leads)
      .leftJoin(activities, eq(activities.leadId, leads.id))
      .where(
        and(
          eq(leads.isConverted, false),
          notInArray(leads.status, ["unqualified"]),
          lt(leads.createdAt, leadCutoff),
          eq(leads.ownerId, mine),
          isNull(activities.id),
        ),
      )
      .limit(30),
    db
      .select({ id: companies.id, name: companies.name, last: companyLastActivity.last })
      .from(companies)
      .leftJoin(companyLastActivity, eq(companyLastActivity.companyId, companies.id))
      .where(
        and(
          eq(companies.status, "active"),
          eq(companies.ownerId, mine),
          or(isNull(companyLastActivity.last), lte(companyLastActivity.last, quietCutoff)),
        ),
      )
      .limit(30),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        createdAt: tasks.createdAt,
        contactId: tasks.contactId,
        leadId: tasks.leadId,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeId, mine),
          ne(tasks.status, "done"),
          eq(tasks.type, "email"),
          like(tasks.title, `${REPLY_TASK_PREFIX}%`),
        ),
      )
      .limit(30),
    // What this person put aside, until the day they chose.
    db
      .select({ kind: nextActionSnoozes.kind, entityId: nextActionSnoozes.entityId, until: nextActionSnoozes.until })
      .from(nextActionSnoozes)
      .where(and(eq(nextActionSnoozes.userId, mine), gt(nextActionSnoozes.until, new Date(now))))
      .catch(() => []),
  ]);

  const found: NextAction[] = [];

  // ── Tickets about to miss, or already missing, their promise ────────────────
  for (const t of liveTickets) {
    if (!t.slaDeadlineAt) continue;
    const left = slaRemainingFraction(t.createdAt, t.slaDeadlineAt, now);
    const breached = t.slaBreachedAt !== null || t.slaDeadlineAt.getTime() <= now;

    if (breached) {
      found.push({
        kind: "sla_breached",
        entity: "ticket",
        id: t.id,
        title: `${t.ticketNumber} — ${t.subject}`,
        detailKey: "pastDeadline",
        detailValue: daysBetween(t.slaDeadlineAt, now),
        href: `/dashboard/support/tickets/${t.id}`,
        urgency: urgencyOf("sla_breached", daysBetween(t.slaDeadlineAt, now)),
      });
    } else if (left <= THRESHOLDS.slaRemainingFraction) {
      found.push({
        kind: "sla_at_risk",
        entity: "ticket",
        id: t.id,
        title: `${t.ticketNumber} — ${t.subject}`,
        detailKey: "slaLeft",
        detailValue: Math.round(left * 100),
        href: `/dashboard/support/tickets/${t.id}`,
        // The less is left, the more urgent — inverted so an empty window scores highest.
        urgency: urgencyOf("sla_at_risk", (THRESHOLDS.slaRemainingFraction - left) * 5),
      });
    }
  }

  // ── Quotes: about to expire, or sent and never opened ───────────────────────

  for (const q of liveQuotes) {
    const followUp = { entity: "deal" as const, id: q.dealId };
    // Accepted is a win not yet booked: until it is an order, nothing ships and the
    // revenue is nowhere but in this quote.
    if (q.status === "accepted") {
      const waiting = daysBetween(q.acceptedAt ?? q.sentAt ?? now, now);
      found.push({
        kind: "quote_to_order",
        entity: "quote",
        id: q.id,
        title: q.quoteNumber,
        detailKey: "acceptedWaiting",
        detailValue: waiting,
        href: `/dashboard/sales/quotes/${q.id}`,
        urgency: urgencyOf("quote_to_order", waiting / 3),
        followUp,
      });
      continue;
    }
    if (q.expiresAt) {
      const daysLeft = Math.ceil((q.expiresAt.getTime() - now) / DAY_MS);
      if (daysLeft <= THRESHOLDS.quoteExpiringDays) {
        found.push({
          kind: "quote_expiring",
          entity: "quote",
          id: q.id,
          title: q.quoteNumber,
          detailKey: daysLeft <= 0 ? "expired" : "expiresIn",
          detailValue: daysLeft,
          href: `/dashboard/sales/quotes/${q.id}`,
          urgency: urgencyOf("quote_expiring", Math.max(0, -daysLeft)),
          followUp,
        });
        continue;
      }
    }

    // Sent and never opened is a different problem from sent and considered: the
    // first means the email did not land, and no amount of waiting fixes it.
    if (q.sentAt && !q.viewedAt) {
      const quiet = daysBetween(q.sentAt, now);
      if (quiet >= THRESHOLDS.quoteUnopenedDays) {
        found.push({
          kind: "quote_unopened",
          entity: "quote",
          id: q.id,
          title: q.quoteNumber,
          detailKey: "sentNeverOpened",
          detailValue: quiet,
          href: `/dashboard/sales/quotes/${q.id}`,
          urgency: urgencyOf("quote_unopened", quiet / THRESHOLDS.quoteUnopenedDays - 1),
          followUp,
        });
      }
    }
  }

  // ── Deals that have stopped moving, or are past their own close date ────────
  //
  // "Touched" means an activity happened, not that the row was written: re-saving a
  // deal to fix a typo is not contact with the customer, and neither is a meeting
  // booked for next week. The board reads the same definition (src/lib/deal-signals.ts).
  for (const d of openDeals) {
    if (d.expectedCloseDate && d.expectedCloseDate.getTime() < now) {
      const late = daysBetween(d.expectedCloseDate, now);
      found.push({
        kind: "deal_overdue",
        entity: "deal",
        id: d.id,
        title: d.name,
        detailKey: "shouldHaveClosed",
        detailValue: late,
        href: `/dashboard/pipeline/${d.id}`,
        urgency: urgencyOf("deal_overdue", late / THRESHOLDS.dealStalledDays),
        followUp: { entity: "deal", id: d.id },
      });
      continue;
    }

    const { idleDays: quiet, stalled } = dealSignals(
      { createdAt: d.createdAt, lastActivityAt: d.lastTouched, hasNextStep: false, nextStepAt: null },
      new Date(now),
    );
    if (stalled) {
      found.push({
        kind: "deal_stalled",
        entity: "deal",
        id: d.id,
        title: d.name,
        detailKey: "noContactFor",
        detailValue: quiet,
        href: `/dashboard/pipeline/${d.id}`,
        urgency: urgencyOf("deal_stalled", quiet / THRESHOLDS.dealStalledDays - 1),
        followUp: { entity: "deal", id: d.id },
      });
      continue;
    }

    // ⚠️ One row per deal: a deal already late or stalled says so above, and a second
    // row for the same deal would only push something else off the list.
    if (!(Number(d.steps) > 0)) {
      found.push({
        kind: "deal_no_next_step",
        entity: "deal",
        id: d.id,
        title: d.name,
        detailKey: "nothingPlanned",
        detailValue: quiet,
        href: `/dashboard/pipeline/${d.id}`,
        urgency: urgencyOf("deal_no_next_step", quiet / THRESHOLDS.dealStalledDays),
        followUp: { entity: "deal", id: d.id },
      });
    }
  }

  // ── Leads nobody has answered ──────────────────────────────────────────────

  for (const l of coldLeads) {
    const quiet = daysBetween(l.createdAt, now);
    found.push({
      kind: "lead_untouched",
      entity: "lead",
      id: l.id,
      title: [l.firstName, l.lastName].filter(Boolean).join(" ") || (l.companyName ?? "Lead"),
      detailKey: "arrivedNeverContacted",
      detailValue: quiet,
      href: `/dashboard/leads/${l.id}`,
      // A hot lead left alone is later than a cold one left alone as long.
      urgency: urgencyOf("lead_untouched", quiet / THRESHOLDS.leadUntouchedDays - 1 + leadScoreWeight(l.leadScore)),
      followUp: { entity: "lead", id: l.id },
    });
  }

  // ── Customers who have gone quiet ──────────────────────────────────────────

  for (const c of quietCustomers) {
    // A customer with no activity at all is a record, not a lapse: it says nothing
    // about the relationship, only that nobody has written anything down.
    if (!c.last) continue;
    const quiet = daysBetween(c.last, now);
    found.push({
      kind: "customer_quiet",
      entity: "company",
      id: c.id,
      title: c.name,
      detailKey: "noContactFor",
      detailValue: quiet,
      href: `/dashboard/companies/${c.id}`,
      urgency: urgencyOf("customer_quiet", quiet / THRESHOLDS.customerQuietDays - 1),
      followUp: { entity: "company", id: c.id },
    });
  }

  // ── Replies owed: a customer wrote to their owner (src/lib/inbound-sales-reply.ts) ──
  for (const r of replies) {
    const waiting = daysBetween(r.createdAt, now);
    found.push({
      kind: "reply_due",
      entity: "task",
      id: r.id,
      title: r.title.slice(REPLY_TASK_PREFIX.length),
      detailKey: "waitingReply",
      detailValue: waiting,
      href: r.contactId
        ? `/dashboard/contacts/${r.contactId}`
        : r.leadId
          ? `/dashboard/leads/${r.leadId}`
          : "/dashboard/tasks",
      urgency: urgencyOf("reply_due", waiting),
      taskId: r.id,
    });
  }

  return buildWorkList(withoutSnoozed(found, snoozes, now), limit);
}

const SNOOZE_DAYS = new Set([1, 3, 7]);

/**
 * Puts one row of the work list aside for a few days. Personal: nobody else's list moves.
 * The row comes back on its own when the day arrives, if it still applies.
 */
export async function snoozeNextActionAction(kind: string, entityId: string, days: number): Promise<void> {
  const actor = await requireCapability("record:read");
  if (!SNOOZE_DAYS.has(days)) throw new Error("A snooze is 1, 3 or 7 days.");
  const db = await getDb();
  const until = new Date(Date.now() + days * DAY_MS);
  await db
    .insert(nextActionSnoozes)
    .values({ userId: actor.userId, kind, entityId, until })
    .onConflictDoUpdate({
      target: [nextActionSnoozes.userId, nextActionSnoozes.kind, nextActionSnoozes.entityId],
      set: { until },
    });
}

/**
 * The work list as a queue: each row with the person to call about it and the record the
 * call is logged on (src/lib/record-reach.ts). The same rows, in the same order, as the
 * home's list — the queue is a way of working it, not a second list.
 */
export async function getWorkQueue() {
  const actions = await getNextActions(50);
  const db = await getDb();
  const keys: ReachKey[] = actions.map((a) =>
    a.followUp
      ? { entity: a.followUp.entity, id: a.followUp.id }
      : a.taskId
        ? { entity: "task", id: a.taskId }
        : { entity: a.entity as ReachKey["entity"], id: a.id },
  );
  const reach = await reachFor(db, keys);
  return actions.map((a, i) => ({ ...a, reach: reach.get(`${keys[i].entity}:${keys[i].id}`) ?? null }));
}

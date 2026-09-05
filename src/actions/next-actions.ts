"use server";

import { and, desc, eq, isNotNull, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";

import { activities, companies, deals, leads, quotes, tickets } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import {
  buildWorkList,
  daysBetween,
  type NextAction,
  slaRemainingFraction,
  THRESHOLDS,
  urgencyOf,
} from "@/lib/next-actions";
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

  const found: NextAction[] = [];

  // ── Tickets about to miss, or already missing, their promise ────────────────
  const liveTickets = await db
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
    .limit(50);

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
  const liveQuotes = await db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      status: quotes.status,
      sentAt: quotes.sentAt,
      viewedAt: quotes.viewedAt,
      expiresAt: quotes.expiresAt,
      totalAmount: quotes.totalAmount,
    })
    .from(quotes)
    .where(and(or(eq(quotes.status, "sent"), eq(quotes.status, "viewed")), eq(quotes.ownerId, mine)))
    .orderBy(desc(quotes.sentAt))
    .limit(50);

  for (const q of liveQuotes) {
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
        });
      }
    }
  }

  // ── Deals that have stopped moving, or are past their own close date ────────
  //
  // "Touched" means an activity was recorded against it, not that the row was
  // written: re-saving a deal to fix a typo is not contact with the customer.
  const stalledCutoff = new Date(now - THRESHOLDS.dealStalledDays * DAY_MS);
  const lastActivity = db
    .select({
      dealId: activities.dealId,
      last: sql<Date>`max(${activities.createdAt})`.as("last"),
    })
    .from(activities)
    .where(isNotNull(activities.dealId))
    .groupBy(activities.dealId)
    .as("last_activity");

  const openDeals = await db
    .select({
      id: deals.id,
      name: deals.name,
      updatedAt: deals.updatedAt,
      expectedCloseDate: deals.expectedCloseDate,
      lastTouched: lastActivity.last,
    })
    .from(deals)
    .leftJoin(lastActivity, eq(lastActivity.dealId, deals.id))
    .where(and(eq(deals.status, "open"), eq(deals.ownerId, mine)))
    .limit(100);

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
        href: `/dashboard/pipeline?deal=${d.id}`,
        urgency: urgencyOf("deal_overdue", late / THRESHOLDS.dealStalledDays),
      });
      continue;
    }

    const touched = d.lastTouched ? new Date(d.lastTouched) : d.updatedAt;
    if (touched.getTime() < stalledCutoff.getTime()) {
      const quiet = daysBetween(touched, now);
      found.push({
        kind: "deal_stalled",
        entity: "deal",
        id: d.id,
        title: d.name,
        detailKey: "noContactFor",
        detailValue: quiet,
        href: `/dashboard/pipeline?deal=${d.id}`,
        urgency: urgencyOf("deal_stalled", quiet / THRESHOLDS.dealStalledDays - 1),
      });
    }
  }

  // ── Leads nobody has answered ──────────────────────────────────────────────
  const leadCutoff = new Date(now - THRESHOLDS.leadUntouchedDays * DAY_MS);
  const coldLeads = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      companyName: leads.companyName,
      createdAt: leads.createdAt,
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
    .limit(30);

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
      urgency: urgencyOf("lead_untouched", quiet / THRESHOLDS.leadUntouchedDays - 1),
    });
  }

  // ── Customers who have gone quiet ──────────────────────────────────────────
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

  const quietCustomers = await db
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
    .limit(30);

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
    });
  }

  return buildWorkList(found, limit);
}

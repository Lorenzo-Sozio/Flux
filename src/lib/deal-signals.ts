import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import { activities, deals, tasks } from "@/db/schema";
import { daysBetween, THRESHOLDS } from "@/lib/next-actions";
import { type RecordScope, SEE_ALL, visibleWhere } from "@/lib/record-visibility";

/**
 * Two facts about an open deal, worked out when it is read rather than stored.
 *
 *  - **Idle:** days since the last thing that happened with the customer — an activity
 *    whose moment has passed. Re-saving the deal to fix a typo is not contact, and a
 *    meeting booked for next week has not happened yet.
 *  - **Next step:** an open task on the deal, or an activity booked in the future.
 *
 * ⚠️ These replace `deal.health_score`, a number written only straight after an edit —
 * when `updatedAt` was "now", so none of its inactivity penalties could ever apply. A
 * new deal was red because nobody had computed it, and one abandoned for sixty days
 * stayed green. A stored judgement about time goes stale by construction.
 */

/** When the activity happened: its own date, or when it was written down. */
const activityMoment = sql`coalesce(${activities.date}, ${activities.createdAt})`;

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** Latest past activity per deal, as a subquery to left-join on `dealId`. */
export function lastActivityByDeal(db: AnyDb, now: Date) {
  return db
    .select({
      dealId: activities.dealId,
      // ⚠️ mapWith: a raw aggregate skips the column's decoder, and a `timestamp` read
      // without it is taken as local time — two hours out in Rome.
      at: sql<Date | null>`max(${activityMoment})`.mapWith(activities.createdAt).as("last_activity_at"),
    })
    .from(activities)
    .where(and(isNotNull(activities.dealId), sql`${activityMoment} <= ${now}`))
    .groupBy(activities.dealId)
    .as("deal_last_activity");
}

/** Earliest next step per deal: open tasks (any due date) and activities still to come. */
export function nextStepByDeal(db: AnyDb, now: Date) {
  const openTasks = db
    .select({ dealId: tasks.dealId, at: sql`${tasks.dueDate}`.as("at") })
    .from(tasks)
    .where(and(isNotNull(tasks.dealId), ne(tasks.status, "done")));
  const booked = db
    .select({ dealId: activities.dealId, at: sql`${activities.date}`.as("at") })
    .from(activities)
    .where(and(isNotNull(activities.dealId), sql`${activities.date} > ${now}`));
  const steps = openTasks.unionAll(booked).as("deal_steps");
  return db
    .select({
      dealId: steps.dealId,
      at: sql<Date | null>`min(${steps.at})`.mapWith(tasks.dueDate).as("next_step_at"),
      // Counted apart from `at`: a task with no due date is a next step whose min() is null.
      n: sql<number>`count(*)::int`.as("next_step_count"),
    })
    .from(steps)
    .groupBy(steps.dealId)
    .as("deal_next_step");
}

export interface DealSignals {
  /** Days since the last contact, or since the deal was created when there was none. */
  idleDays: number;
  /** Idle for at least the threshold the work list uses to call a deal stalled. */
  stalled: boolean;
  hasNextStep: boolean;
  /** When the next step is due; null for an open task with no due date. */
  nextStepAt: Date | null;
}

export function dealSignals(
  deal: {
    createdAt: Date | string;
    lastActivityAt: Date | string | null;
    hasNextStep: boolean;
    nextStepAt: Date | string | null;
  },
  now: Date = new Date(),
): DealSignals {
  const since = deal.lastActivityAt ?? deal.createdAt;
  const idleDays = daysBetween(since, now);
  return {
    idleDays,
    stalled: idleDays >= THRESHOLDS.dealStalledDays,
    hasNextStep: deal.hasNextStep,
    nextStepAt: deal.nextStepAt ? new Date(deal.nextStepAt) : null,
  };
}

/**
 * How many open deals have nothing planned: one owner's — the home's own number — or,
 * with `null`, the whole team's (the sales manager's dashboard) — narrowed to `scope`, the
 * reader's (src/lib/record-visibility.ts), so a salesperson's "team" is the deals they may see.
 */
export async function countOpenDealsWithoutNextStep(
  db: AnyDb,
  ownerId: string | null,
  scope: RecordScope = SEE_ALL,
  now: Date = new Date(),
): Promise<number> {
  const next = nextStepByDeal(db, now);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deals)
    .leftJoin(next, eq(next.dealId, deals.id))
    .where(
      and(
        eq(deals.status, "open"),
        ownerId === null ? undefined : eq(deals.ownerId, ownerId),
        visibleWhere("deal", scope),
        sql`${next.n} is null`,
      ),
    );
  return Number(row?.n ?? 0);
}

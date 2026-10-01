import { cache } from "react";

import { and, desc, eq, inArray, lt, or, type SQL, sql } from "drizzle-orm";

import {
  activities,
  companies,
  contacts,
  deals,
  pipelineStages,
  priceLists,
  quoteActivities,
  quotes,
  users,
} from "@/db/schema";
import { countFieldChanges, type HistoryEntity, readFieldChanges } from "@/lib/field-history";
import { type RecordScope, recordScope, visibleWhere } from "@/lib/record-visibility";
import type { getDb } from "@/lib/tenant-context";

/**
 * Everything that happened around a record, in one list — the record's own activities and
 * those of the people and deals under it, its field changes, and its quotes' events.
 *
 * ⚠️⚠️ The timeline showed only activities carrying the record's *own* key. A company did
 * not see what was logged on its contacts and deals, a contact did not see its deals' —
 * so the call that moved the deal was invisible from the company it was for. It was also
 * ordered by when a row was typed rather than when the thing happened, and never paged.
 *
 *  - company ← its contacts and its deals
 *  - contact ← its deals
 *  - deal, lead ← themselves
 */

type Db = Awaited<ReturnType<typeof getDb>>;

export type TimelineScope = { type: "company" | "contact" | "deal" | "lead"; id: string };

/** Where an entry came from, when it is not the record being looked at. */
export interface TimelineVia {
  type: "contact" | "deal";
  id: string;
  name: string;
}

export type TimelineItem =
  | {
      kind: "activity";
      key: string;
      at: string;
      id: string;
      type: string;
      content: string | null;
      outcome: string | null;
      date: string | null;
      createdAt: string;
      durationMinutes: number | null;
      participants: string | null;
      ownerName: string | null;
      via: TimelineVia | null;
    }
  | {
      kind: "change";
      key: string;
      at: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      /** A name for an id (stage, owner, company…), when the value is one. */
      oldLabel: string | null;
      newLabel: string | null;
      byName: string | null;
      via: TimelineVia | null;
    }
  | {
      kind: "quote";
      key: string;
      at: string;
      quoteId: string;
      quoteNumber: string;
      event: string;
      byName: string | null;
      via: TimelineVia | null;
    };

export const TIMELINE_PAGE = 30;

/**
 * The record, and the records whose history it shows as its own. Read once per request: the page's
 * summary and the timeline's first page both need it (React's `cache()`, keyed by primitives).
 */
const relatedOf = cache(async (db: Db, type: TimelineScope["type"], id: string) => {
  // ⚠️⚠️ Only the contacts and deals the reader may see: a company seen through one's own deal
  // must not show a colleague's deals there, nor what was written on them (record-visibility.ts).
  const scope = await recordScope();
  // The company's contacts and its deals at once: two independent reads, one round trip.
  const [contactRows, dealRows] = await Promise.all([
    type === "company"
      ? db
          .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName })
          .from(contacts)
          .where(and(eq(contacts.companyId, id), visibleWhere("contact", scope)))
      : Promise.resolve([] as { id: string; first: string | null; last: string | null }[]),
    type === "company"
      ? db
          .select({ id: deals.id, name: deals.name })
          .from(deals)
          .where(and(eq(deals.companyId, id), visibleWhere("deal", scope)))
      : type === "contact"
        ? db
            .select({ id: deals.id, name: deals.name })
            .from(deals)
            .where(and(eq(deals.contactId, id), visibleWhere("deal", scope)))
        : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const via = new Map<string, TimelineVia>();
  for (const c of contactRows) {
    via.set(`contact:${c.id}`, { type: "contact", id: c.id, name: `${c.first ?? ""} ${c.last ?? ""}`.trim() });
  }
  for (const d of dealRows) via.set(`deal:${d.id}`, { type: "deal", id: d.id, name: d.name });
  return { contactIds: contactRows.map((c) => c.id), dealIds: dealRows.map((d) => d.id), via, scope };
});

function related(db: Db, scope: TimelineScope) {
  return relatedOf(db, scope.type, scope.id);
}

const activityMoment = sql`coalesce(${activities.date}, ${activities.createdAt})`;

function activityScope(scope: TimelineScope, contactIds: string[], dealIds: string[], visible: RecordScope): SQL {
  const own =
    scope.type === "company"
      ? eq(activities.companyId, scope.id)
      : scope.type === "contact"
        ? eq(activities.contactId, scope.id)
        : scope.type === "deal"
          ? eq(activities.dealId, scope.id)
          : eq(activities.leadId, scope.id);
  const parts: SQL[] = [own];
  if (contactIds.length) parts.push(inArray(activities.contactId, contactIds));
  if (dealIds.length) parts.push(inArray(activities.dealId, dealIds));
  // A colleague's call on the company itself, about their own deal, stays theirs.
  return and(or(...parts), visibleWhere("activity", visible)) as SQL;
}

function quoteScope(scope: TimelineScope, dealIds: string[], visible: RecordScope): SQL | null {
  if (scope.type === "lead") return null;
  const seen = visibleWhere("quote", visible);
  if (scope.type === "company") return and(eq(quotes.companyId, scope.id), seen) as SQL;
  if (scope.type === "deal") return and(eq(quotes.dealId, scope.id), seen) as SQL;
  const parts: SQL[] = [eq(quotes.contactId, scope.id)];
  if (dealIds.length) parts.push(inArray(quotes.dealId, dealIds));
  return and(or(...parts), seen) as SQL;
}

/** One page of the timeline, newest first, strictly before `before` when given. */
export async function loadRecordTimeline(
  db: Db,
  scope: TimelineScope,
  opts: { before?: Date; limit?: number } = {},
): Promise<{ items: TimelineItem[]; hasMore: boolean }> {
  const limit = opts.limit ?? TIMELINE_PAGE;
  // One more than a page from each source, and room for a save's several field changes.
  const fetch = limit + 20;
  const { contactIds, dealIds, via, scope: visible } = await related(db, scope);

  // Activities, field changes and quote events are independent: read side by side, not in turn.
  const qScope = quoteScope(scope, dealIds, visible);
  const historyRecords: { type: HistoryEntity; ids: string[] }[] = [
    { type: scope.type, ids: [scope.id] },
    { type: "contact", ids: contactIds },
    { type: "deal", ids: dealIds },
  ];
  const activityRowsP = db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      outcome: activities.outcome,
      date: activities.date,
      createdAt: activities.createdAt,
      durationMinutes: activities.durationMinutes,
      participants: activities.participants,
      contactId: activities.contactId,
      dealId: activities.dealId,
      ownerName: users.name,
      at: sql<Date>`${activityMoment}`.mapWith(activities.createdAt),
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.ownerId))
    .where(
      and(
        activityScope(scope, contactIds, dealIds, visible),
        opts.before ? lt(activityMoment, opts.before) : undefined,
      ),
    )
    .orderBy(desc(activityMoment))
    .limit(fetch);

  const changeRowsP = readFieldChanges(db, historyRecords, { before: opts.before, limit: fetch });

  const quoteRowsP = qScope
    ? db
        .select({
          id: quoteActivities.id,
          type: quoteActivities.type,
          createdAt: quoteActivities.createdAt,
          email: quoteActivities.email,
          quoteId: quotes.id,
          quoteNumber: quotes.quoteNumber,
          dealId: quotes.dealId,
          byName: users.name,
        })
        .from(quoteActivities)
        .innerJoin(quotes, eq(quotes.id, quoteActivities.quoteId))
        .leftJoin(users, eq(users.id, quoteActivities.userId))
        .where(and(qScope, opts.before ? lt(quoteActivities.createdAt, opts.before) : undefined))
        .orderBy(desc(quoteActivities.createdAt))
        .limit(fetch)
    : Promise.resolve([]);

  const [activityRows, changeRows, quoteRows] = await Promise.all([activityRowsP, changeRowsP, quoteRowsP]);
  const labels = await labelsFor(db, changeRows);
  const viaOf = (contactId: string | null, dealId: string | null): TimelineVia | null => {
    if (scope.type === "company" && contactId && via.has(`contact:${contactId}`))
      return via.get(`contact:${contactId}`) ?? null;
    if (dealId && via.has(`deal:${dealId}`)) return via.get(`deal:${dealId}`) ?? null;
    return null;
  };

  const all: TimelineItem[] = [
    ...activityRows.map(
      (a): TimelineItem => ({
        kind: "activity",
        key: `a:${a.id}`,
        at: new Date(a.at).toISOString(),
        id: a.id,
        type: a.type,
        content: a.content,
        outcome: a.outcome,
        date: a.date ? a.date.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        durationMinutes: a.durationMinutes,
        participants: a.participants,
        ownerName: a.ownerName,
        // An activity logged on the record itself is not "via" anything, even if it also
        // names one of its deals.
        via: ownActivity(scope, a) ? null : viaOf(a.contactId, a.dealId),
      }),
    ),
    ...changeRows.map(
      (c): TimelineItem => ({
        kind: "change",
        key: `c:${c.id}`,
        at: c.changedAt.toISOString(),
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        oldLabel: c.oldValue ? (labels.get(`${c.field}:${c.oldValue}`) ?? null) : null,
        newLabel: c.newValue ? (labels.get(`${c.field}:${c.newValue}`) ?? null) : null,
        byName: c.changedBy ? (labels.get(`ownerId:${c.changedBy}`) ?? null) : null,
        via:
          c.entityType === scope.type && c.entityId === scope.id
            ? null
            : (via.get(`${c.entityType}:${c.entityId}`) ?? null),
      }),
    ),
    ...quoteRows.map(
      (q): TimelineItem => ({
        kind: "quote",
        key: `q:${q.id}`,
        at: q.createdAt.toISOString(),
        quoteId: q.quoteId,
        quoteNumber: q.quoteNumber,
        event: q.type,
        byName: q.byName ?? q.email,
        via: scope.type === "deal" ? null : viaOf(null, q.dealId),
      }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // ⚠️ A page never ends in the middle of one moment: the next page asks for what came
  // strictly before the last entry, so the rest of a save's field changes would be lost.
  let end = Math.min(limit, all.length);
  while (end < all.length && all[end].at === all[end - 1].at) end++;
  const hasMore =
    all.length > end || activityRows.length === fetch || changeRows.length === fetch || quoteRows.length === fetch;
  return { items: all.slice(0, end), hasMore };
}

function ownActivity(scope: TimelineScope, a: { contactId: string | null; dealId: string | null }): boolean {
  if (scope.type === "contact") return a.contactId === scope.id;
  if (scope.type === "deal") return a.dealId === scope.id;
  return false;
}

/** Names for the ids a change can hold, in a handful of queries. */
async function labelsFor(
  db: Db,
  rows: { field: string; oldValue: string | null; newValue: string | null; changedBy: string | null }[],
) {
  const ids = (field: string) =>
    [...new Set(rows.filter((r) => r.field === field).flatMap((r) => [r.oldValue, r.newValue]))].filter(
      (v): v is string => Boolean(v),
    );
  const people = [
    ...new Set([...ids("ownerId"), ...rows.map((r) => r.changedBy).filter((v): v is string => Boolean(v))]),
  ];
  const out = new Map<string, string>();
  const put = (field: string, list: { id: string; name: string | null }[]) => {
    for (const r of list) if (r.name) out.set(`${field}:${r.id}`, r.name);
  };
  const stageIds = ids("stageId");
  const companyIds = ids("companyId");
  const contactIds = ids("contactId");
  const listIds = ids("priceListId");
  // The names behind the ids, every kind at once: up to five lookups, one round trip.
  const [owners, stages, companyRows, contactRows, lists] = await Promise.all([
    people.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, people))
      : Promise.resolve([]),
    stageIds.length
      ? db
          .select({ id: pipelineStages.id, name: pipelineStages.name })
          .from(pipelineStages)
          .where(inArray(pipelineStages.id, stageIds))
      : Promise.resolve([]),
    companyIds.length
      ? db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds))
      : Promise.resolve([]),
    contactIds.length
      ? db
          .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName })
          .from(contacts)
          .where(inArray(contacts.id, contactIds))
      : Promise.resolve([] as { id: string; first: string | null; last: string | null }[]),
    listIds.length
      ? db.select({ id: priceLists.id, name: priceLists.name }).from(priceLists).where(inArray(priceLists.id, listIds))
      : Promise.resolve([]),
  ]);
  put("ownerId", owners);
  put("stageId", stages);
  put("companyId", companyRows);
  put(
    "contactId",
    contactRows.map((c) => ({ id: c.id, name: `${c.first ?? ""} ${c.last ?? ""}`.trim() })),
  );
  put("priceListId", lists);
  return out;
}

/**
 * How many entries the timeline holds, and when the customer was last in contact —
 * for the section's count and the header, so neither disagrees with the list.
 */
export async function recordTimelineSummary(
  db: Db,
  scope: TimelineScope,
  now: Date = new Date(),
): Promise<{ count: number; lastContactAt: Date | null }> {
  const { contactIds, dealIds, scope: visible } = await related(db, scope);
  const where = activityScope(scope, contactIds, dealIds, visible);
  const qScope = quoteScope(scope, dealIds, visible);
  // Three independent counts, side by side.
  const [[a], changes, [q]] = await Promise.all([
    db
      .select({
        n: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${activityMoment}) filter (where ${activityMoment} <= ${now})`.mapWith(
          activities.createdAt,
        ),
      })
      .from(activities)
      .where(where),
    countFieldChanges(db, [
      { type: scope.type, ids: [scope.id] },
      { type: "contact", ids: contactIds },
      { type: "deal", ids: dealIds },
    ]),
    qScope
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(quoteActivities)
          .innerJoin(quotes, eq(quotes.id, quoteActivities.quoteId))
          .where(qScope)
      : Promise.resolve([{ n: 0 }]),
  ]);
  return {
    count: Number(a?.n ?? 0) + changes + Number(q?.n ?? 0),
    lastContactAt: a?.last ? new Date(a.last) : null,
  };
}

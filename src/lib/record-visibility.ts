/**
 * Who sees which customer: the visibility rules of leads, contacts, companies and deals.
 *
 * Several salespeople in one workspace must not read each other's customers — a contact list
 * open to everybody is a contact list anybody can take. So, unless the workspace says otherwise
 * (Settings → Users, "Who sees which records"), the usual CRM rules apply:
 *
 * - **Administrators and the owner see everything** (`record:manageAny`), and so does Flux staff.
 * - **Everybody else sees** what they own, what is assigned to a group they belong to, and what
 *   is assigned to nobody (no owner, no group) — the pool somebody still has to take on.
 * - **A customer is seen through what one works on**: the owner of a company sees its contacts
 *   and deals, and whoever owns a deal or a contact sees the company it belongs to. Only through
 *   records one *owns* (or one's group does) — never through an unassigned one, or an unassigned
 *   company would open every contact filed under it.
 *
 * ⚠️⚠️ **A request with no person behind it sees everything**: a scheduled job, an API key, a
 * webhook, a public page. Every person-facing read already demanded a capability first, which
 * throws without a session, so "no actor" here is always a machine.
 *
 * ⚠️⚠️ **The clauses name the tables as written** (`"company"."id"`): a query that aliases one of
 * these tables cannot use them as they are.
 */
import { cache } from "react";

import { eq, type inArray, type SQL, sql } from "drizzle-orm";

import { userGroupMembers, workspaceSettings } from "@/db/schema";
import { type Actor, can } from "@/lib/permissions";

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

export type RecordKind = "lead" | "contact" | "company" | "deal";

/** What one person may see: everything, or their own, their groups' and the unassigned. */
export type RecordScope = { all: true } | { all: false; userId: string; groupIds: string[] };

export const SEE_ALL: RecordScope = { all: true };

// ─── The workspace's choice ───────────────────────────────────────────────────

/** `team`: the rules above. `all`: everybody sees every record, as before 1 October 2026. */
export const VISIBILITY_MODES = ["team", "all"] as const;
export type VisibilityMode = (typeof VISIBILITY_MODES)[number];

const MODE_KEY = "visibility.records";

/**
 * The workspace's mode; no row means `team`. ⚠️ A failed read is `team` too: failing open would
 * show every salesperson every customer the moment the database hiccups.
 */
export async function readVisibilityMode(db: AnyDb): Promise<VisibilityMode> {
  try {
    const [row] = await db
      .select({ value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.key, MODE_KEY));
    return row?.value === "all" ? "all" : "team";
  } catch {
    return "team";
  }
}

export async function writeVisibilityMode(db: AnyDb, mode: VisibilityMode): Promise<void> {
  await db
    .insert(workspaceSettings)
    .values({ key: MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: workspaceSettings.key, set: { value: mode, updatedAt: sql`now()` } });
}

// ─── One person's scope ───────────────────────────────────────────────────────

/** Pure: the scope for an actor, given the workspace's mode and the groups they belong to. */
export function scopeFor(actor: Actor | null, mode: VisibilityMode, groupIds: readonly string[]): RecordScope {
  if (!actor) return SEE_ALL;
  if (mode === "all" || can(actor, "record:manageAny")) return SEE_ALL;
  return { all: false, userId: actor.userId, groupIds: [...new Set(groupIds)] };
}

/** The groups a person belongs to, in this workspace. */
export async function groupsOf(db: AnyDb, userId: string): Promise<string[]> {
  const rows: { groupId: string }[] = await db
    .select({ groupId: userGroupMembers.groupId })
    .from(userGroupMembers)
    .where(eq(userGroupMembers.userId, userId));
  return rows.map((r) => r.groupId);
}

/** The scope of whoever is asking, read once per request. */
export const recordScope = cache(async function recordScope(): Promise<RecordScope> {
  // Imported here, not at the top: this module is also read by code that has no request (tests,
  // jobs), and the auth chain pulls the whole session machinery in with it.
  let getActor: typeof import("@/lib/auth-guard").getActor;
  try {
    ({ getActor } = await import("@/lib/auth-guard"));
  } catch {
    // Only a test runner without Next lands here: the session machinery cannot even load. In
    // production the same module is what every action's capability check already loaded. A
    // failure to *read* the session below is not caught, and refuses the request.
    return SEE_ALL;
  }
  const actor = await getActor();
  if (!actor || can(actor, "record:manageAny")) return SEE_ALL;
  const { getDb } = await import("@/lib/tenant-context");
  const db = await getDb();
  const [mode, groupIds] = await Promise.all([readVisibilityMode(db), groupsOf(db, actor.userId)]);
  return scopeFor(actor, mode, groupIds);
});

// ─── The clauses ──────────────────────────────────────────────────────────────

/**
 * What hangs off a customer, and is seen when what it hangs off is (`throughLink`):
 * - quotes, orders and contracts: one's own, or for a deal or customer one sees;
 * - invoices: one made, or for an order or customer one sees;
 * - tasks, activities and appointments: one's own (owner, assignee, organiser, invited), or about
 *   a record one sees — and, attached to no customer at all, everybody's, like an internal meeting;
 * - attached documents: those of a record one sees.
 */
export type LinkedKind = "quote" | "order" | "contract" | "invoice" | "task" | "activity" | "appointment" | "document";
export type VisibleKind = RecordKind | LinkedKind;

const TABLE: Record<VisibleKind, string> = {
  lead: "lead",
  contact: "contact",
  company: "company",
  deal: "deal",
  quote: "quote",
  order: "order",
  contract: "contract",
  invoice: "invoice",
  task: "task",
  activity: "activity",
  appointment: "appointment",
  document: "document",
};

/** `column` names a row of `kind` the scope may see. NULL is not in any set, so it is false. */
function inKind(column: SQL, kind: VisibleKind, scope: Extract<RecordScope, { all: false }>): SQL {
  const t = TABLE[kind];
  return sql`${column} IN (SELECT ${ident(t, "id")} FROM ${sql.raw(`"${t}"`)} WHERE ${visibleWhere(kind, scope) as SQL})`;
}

const RECORD_KINDS: readonly string[] = ["lead", "contact", "company", "deal"];
const isRecordKind = (kind: VisibleKind): kind is RecordKind => RECORD_KINDS.includes(kind);

const LINKS = { lead: "lead_id", contact: "contact_id", company: "company_id", deal: "deal_id" } as const;
type Link = keyof typeof LINKS;

/**
 * Seen through its most specific link — the deal, then the person, then the lead, then the
 * company — and `unlinked` when it has none.
 *
 * ⚠️⚠️ The most specific, not any: a colleague's call logged on their deal also names the company,
 * and the company may be one the person sees through a deal of their own. Read through any link,
 * the colleague's notes, quotes and tasks on that deal came with it while the deal itself did not.
 */
function throughLink(
  table: string,
  order: readonly Link[],
  scope: Extract<RecordScope, { all: false }>,
  unlinked: SQL,
): SQL {
  const branches = order.map(
    (k) => sql`WHEN ${ident(table, LINKS[k])} IS NOT NULL THEN ${inKind(ident(table, LINKS[k]), k, scope)}`,
  );
  return sql`(CASE ${sql.join(branches, sql` `)} ELSE ${unlinked} END)`;
}

function linkedWhere(kind: LinkedKind, scope: Extract<RecordScope, { all: false }>): SQL {
  const t = TABLE[kind];
  const me = scope.userId;
  switch (kind) {
    case "quote":
    case "order":
    case "contract":
      // One's own document, or one about a deal or customer one sees; with no customer at all,
      // only if it belongs to nobody.
      return sql`(${ident(t, "owner_id")} = ${me}
        OR ${throughLink(t, ["deal", "contact", "company"], scope, sql`${ident(t, "owner_id")} IS NULL`)})`;
    case "invoice":
      // An invoice follows its order, else its customer.
      return sql`(${ident(t, "created_by")} = ${me} OR (CASE
        WHEN ${ident(t, "order_id")} IS NOT NULL THEN ${inKind(ident(t, "order_id"), "order", scope)}
        WHEN ${ident(t, "company_id")} IS NOT NULL THEN ${inKind(ident(t, "company_id"), "company", scope)}
        ELSE TRUE END))`;
    case "task":
      return sql`(${ident(t, "owner_id")} = ${me} OR ${ident(t, "assignee_id")} = ${me}
        OR ${throughLink(t, ["deal", "contact", "lead", "company"], scope, sql`TRUE`)})`;
    case "activity":
      return sql`(${ident(t, "owner_id")} = ${me}
        OR ${throughLink(t, ["deal", "contact", "lead", "company"], scope, sql`TRUE`)})`;
    case "appointment":
      return sql`(${ident(t, "organizer_id")} = ${me}
        OR EXISTS (SELECT 1 FROM "appointment_attendee" "a" WHERE "a"."appointment_id" = ${ident(t, "id")} AND "a"."user_id" = ${me})
        OR ${throughLink(t, ["deal", "contact", "lead", "company"], scope, sql`TRUE`)})`;
    case "document": {
      const parents = ["lead", "contact", "company", "deal", "quote", "order", "contract"] as const;
      return sql`(${ident(t, "entity_type")} IS NULL OR ${ident(t, "entity_type")} NOT IN (${sql.join(
        parents.map((p) => sql`${p}`),
        sql`, `,
      )})
        OR ${sql.join(
          parents.map((p) => sql`(${ident(t, "entity_type")} = ${p} AND ${inKind(ident(t, "entity_id"), p, scope)})`),
          sql` OR `,
        )})`;
    }
  }
}

const ident = (alias: string, column: string) => sql.raw(`"${alias}"."${column}"`);

/** Owned by the person, or assigned to one of their groups. */
function mine(alias: string, scope: Extract<RecordScope, { all: false }>): SQL {
  const owner = sql`${ident(alias, "owner_id")} = ${scope.userId}`;
  if (scope.groupIds.length === 0) return owner;
  return sql`(${owner} OR ${ident(alias, "group_id")} IN (${sql.join(
    scope.groupIds.map((g) => sql`${g}`),
    sql`, `,
  )}))`;
}

function unassigned(alias: string): SQL {
  return sql`(${ident(alias, "owner_id")} IS NULL AND ${ident(alias, "group_id")} IS NULL)`;
}

/**
 * The condition a row of `kind` must meet to be shown, for a WHERE clause; `undefined` when the
 * scope sees everything (Drizzle's `and()` drops it).
 */
export function visibleWhere(kind: VisibleKind, scope: RecordScope): SQL | undefined {
  if (scope.all) return undefined;
  if (!isRecordKind(kind)) return linkedWhere(kind, scope);
  const t = TABLE[kind];
  const own = sql`${mine(t, scope)} OR ${unassigned(t)}`;
  const id = ident(t, "id");
  switch (kind) {
    case "lead":
      return sql`(${own})`;
    case "company":
      return sql`(${own}
        OR EXISTS (SELECT 1 FROM "contact" "v" WHERE "v"."company_id" = ${id} AND ${mine("v", scope)})
        OR EXISTS (SELECT 1 FROM "deal" "v" WHERE "v"."company_id" = ${id} AND ${mine("v", scope)}))`;
    case "contact":
      return sql`(${own}
        OR EXISTS (SELECT 1 FROM "company" "v" WHERE "v"."id" = ${ident(t, "company_id")} AND ${mine("v", scope)})
        OR EXISTS (SELECT 1 FROM "deal" "v" WHERE "v"."contact_id" = ${id} AND ${mine("v", scope)}))`;
    case "deal":
      return sql`(${own}
        OR EXISTS (SELECT 1 FROM "company" "v" WHERE "v"."id" = ${ident(t, "company_id")} AND ${mine("v", scope)})
        OR EXISTS (SELECT 1 FROM "contact" "v" WHERE "v"."id" = ${ident(t, "contact_id")} AND ${mine("v", scope)}))`;
  }
}

/** True when the record exists and `scope` may see it. */
export async function canSeeRecord(db: AnyDb, kind: VisibleKind, id: string, scope: RecordScope): Promise<boolean> {
  const where = visibleWhere(kind, scope);
  const t = sql.raw(`"${TABLE[kind]}"`);
  const result = await db.execute(
    sql`SELECT 1 AS "ok" FROM ${t} WHERE ${ident(TABLE[kind], "id")} = ${id}${where ? sql` AND ${where}` : sql``} LIMIT 1`,
  );
  const rows = Array.isArray(result) ? result : (result?.rows ?? []);
  return rows.length > 0;
}

/** The ids among `ids` that `scope` may see — for an action that takes several at once. */
export async function visibleIds(
  db: AnyDb,
  kind: VisibleKind,
  ids: readonly string[],
  scope: RecordScope,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  if (scope.all) return new Set(ids);
  const where = visibleWhere(kind, scope);
  const t = sql.raw(`"${TABLE[kind]}"`);
  const result = await db.execute(
    sql`SELECT ${ident(TABLE[kind], "id")} AS "id" FROM ${t} WHERE ${ident(TABLE[kind], "id")} IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )}) AND ${where}`,
  );
  const rows: { id: string }[] = Array.isArray(result) ? result : (result?.rows ?? []);
  return new Set(rows.map((r) => r.id));
}

/**
 * Refuses an action on a record the person cannot see — as "not found", which is what it is to
 * them: a refusal naming the record would confirm it exists.
 */
export async function assertCanSee(kind: VisibleKind, id: string): Promise<void> {
  const scope = await recordScope();
  if (scope.all) return;
  const { getDb } = await import("@/lib/tenant-context");
  if (await canSeeRecord(await getDb(), kind, id, scope)) return;
  const { serverT } = await import("@/lib/i18n-server");
  const { ForbiddenError } = await import("@/lib/auth-guard");
  throw new ForbiddenError((await serverT())("generic.recordNotFound"));
}

/**
 * Who a new record belongs to when the form named nobody. For a person whose view is limited, it
 * is theirs: left unassigned, what a salesperson just typed in would be on every colleague's list.
 */
export function ownerOnCreate<T extends { ownerId?: string | null; groupId?: string | null }>(
  scope: RecordScope,
  values: T,
): T {
  if (scope.all || values.ownerId || values.groupId) return values;
  return { ...values, ownerId: scope.userId };
}

/** Narrows ids to the visible ones in one statement per kind, keeping `inArray` callers simple. */
export function inVisible(kind: VisibleKind, column: SQL | Parameters<typeof inArray>[0], scope: RecordScope) {
  const where = visibleWhere(kind, scope);
  if (!where) return undefined;
  const t = sql.raw(`"${TABLE[kind]}"`);
  return sql`${column} IN (SELECT ${ident(TABLE[kind], "id")} FROM ${t} WHERE ${where})`;
}

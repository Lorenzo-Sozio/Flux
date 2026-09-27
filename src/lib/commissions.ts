/**
 * Commissions (L8). They accrue on the won deal (decision D6); "on payment" is to be
 * reconsidered once payments are recorded (I9).
 *
 * ⚠️⚠️ **A win is the one the rest of the product counts** (src/lib/metrics.ts): status
 * `won`, dated by `closedAt`, valued in EUR. The commission report and the scorecard read
 * the same deals for the same month, or one of them is lying about it.
 *
 * ⚠️⚠️ **A rule is a rate from a day.** Changing a rate is a new rule from a later day, so
 * a deal keeps the rate in force on the day it was won. The most specific rule wins —
 * person and pipeline, then person, then pipeline, then everyone — and within the same
 * scope the latest that had started. No rule, or no owner, is a win nobody is paid for,
 * listed as such rather than left out.
 *
 * ⚠️⚠️ **An approved month is frozen.** Approving writes one line per deal as it stood
 * — base, rate, amount, owner — and from then on the month is read from those lines, not
 * recomputed. A deal edited, reopened or deleted afterwards does not move what was paid:
 * the line says what changed (`drift`), for a person to settle.
 *
 * ⚠️ **The approving statement decides.** One statement inserts the month and its lines,
 * and the month's unique index refuses a second approval; a deal can be paid once, by the
 * line's unique index. A month is approved only once it is over: a half month frozen
 * would leave the rest of it unpaid.
 *
 * ⚠️ A deal won in a month already approved — a close dated in the past by an import —
 * is `late`: it is paid with the next month approved rather than never.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { commissionLines, commissionRules, commissionStatements, deals, pipelineStages } from "@/db/schema";
import { monthKeysOf, parsePeriodKey, periodBounds, periodKey } from "@/lib/calendar-period";
import { closedBetween, dealEur } from "@/lib/metrics";
import { ownerCondition, UNASSIGNED } from "@/lib/pipeline-filters";
import { toWallDate } from "@/lib/wall-clock";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface CommissionRule {
  id: string;
  userId: string | null;
  pipelineId: string | null;
  ratePercent: number;
  /** YYYY-MM-DD on the workspace's clock. */
  validFrom: string;
}

/** The rule that pays a deal won by `userId` in `pipelineId` on `day` (YYYY-MM-DD). */
export function ruleFor(
  rules: readonly CommissionRule[],
  deal: { userId: string | null; pipelineId: string | null; day: string },
): CommissionRule | null {
  // Nobody owned it: there is nobody to pay, whatever "everyone" earns.
  if (!deal.userId) return null;
  let best: CommissionRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (r.validFrom > deal.day) continue;
    if (r.userId !== null && r.userId !== deal.userId) continue;
    if (r.pipelineId !== null && r.pipelineId !== deal.pipelineId) continue;
    const score = (r.userId !== null ? 2 : 0) + (r.pipelineId !== null ? 1 : 0);
    if (score > bestScore || (score === bestScore && best !== null && r.validFrom > best.validFrom)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** `ratePercent` of `base`, to the cent. Nothing on a deal worth nothing. */
export function commissionOn(base: number, ratePercent: number): number {
  if (!(base > 0) || !(ratePercent > 0)) return 0;
  // In whole cents: 1.15 × 50 is 57.4999… in binary, and would pay 0.57 where 0.58 is owed.
  return Math.round((Math.round(base * 100) * ratePercent) / 100) / 100;
}

/** What changed on a paid deal since its month was approved. */
export type CommissionDrift = "deleted" | "reopened" | "owner" | "amount";

export interface CommissionLine {
  dealId: string | null;
  dealName: string;
  /** The owner when it was won (approved) or now (not yet approved); null for nobody. */
  userId: string | null;
  wonAt: Date;
  /** The month it counts in, "2026-09". */
  month: string;
  base: number;
  ratePercent: number | null;
  amount: number;
  ruleId: string | null;
  approved: boolean;
  drift: CommissionDrift | null;
  /** Won in a month already approved: paid with the next month approved. */
  late: boolean;
}

export async function loadCommissionRules(db: AnyDb): Promise<CommissionRule[]> {
  const rows = await db
    .select({
      id: commissionRules.id,
      userId: commissionRules.userId,
      pipelineId: commissionRules.pipelineId,
      ratePercent: commissionRules.ratePercent,
      validFrom: commissionRules.validFrom,
    })
    .from(commissionRules)
    .orderBy(commissionRules.validFrom);
  return rows.map((r: CommissionRule & { ratePercent: unknown }) => ({ ...r, ratePercent: Number(r.ratePercent) }));
}

/** Months with a statement, and who approved them when. */
async function statementsOf(db: AnyDb, months?: readonly string[]) {
  return db
    .select({
      id: commissionStatements.id,
      period: commissionStatements.period,
      approvedBy: commissionStatements.approvedBy,
      approvedAt: commissionStatements.approvedAt,
    })
    .from(commissionStatements)
    .where(months ? inArray(commissionStatements.period, [...months]) : undefined) as Promise<
    { id: string; period: string; approvedBy: string | null; approvedAt: Date }[]
  >;
}

/** Won deals not yet paid, closed in [from, to), priced by the rules. */
async function unpaidLines(
  db: AnyDb,
  input: { from: Date; to: Date; timeZone: string; owners?: readonly string[]; rules: readonly CommissionRule[] },
): Promise<Omit<CommissionLine, "late">[]> {
  const rows = await db
    .select({
      id: deals.id,
      name: deals.name,
      ownerId: deals.ownerId,
      closedAt: deals.closedAt,
      base: dealEur,
      pipelineId: pipelineStages.pipelineId,
    })
    .from(deals)
    .leftJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(commissionLines, eq(commissionLines.dealId, deals.id))
    .where(
      and(
        closedBetween("won", input.from, new Date(input.to.getTime() - 1)),
        isNull(commissionLines.id),
        ownerCondition(deals.ownerId, input.owners ?? []),
      ),
    );
  return rows.map(
    (d: {
      id: string;
      name: string;
      ownerId: string | null;
      closedAt: Date;
      base: unknown;
      pipelineId: string | null;
    }) => {
      const day = toWallDate(d.closedAt, input.timeZone);
      const base = Number(d.base);
      const rule = ruleFor(input.rules, { userId: d.ownerId, pipelineId: d.pipelineId, day });
      return {
        dealId: d.id,
        dealName: d.name,
        userId: d.ownerId,
        wonAt: d.closedAt,
        month: day.slice(0, 7),
        base,
        ratePercent: rule ? rule.ratePercent : null,
        amount: rule ? commissionOn(base, rule.ratePercent) : 0,
        ruleId: rule?.id ?? null,
        approved: false,
        drift: null,
      };
    },
  );
}

export interface CommissionRow {
  /** A user id, or `none` (UNASSIGNED) for won deals nobody owned. */
  userId: string;
  deals: number;
  base: number;
  amount: number;
  /** Of `amount`, what is in approved months. */
  approved: number;
  /** Won deals no rule paid. */
  unpaid: number;
}

export interface CommissionReport {
  period: string;
  months: { month: string; approvedAt: Date | null; approvedBy: string | null }[];
  lines: CommissionLine[];
  rows: CommissionRow[];
  totals: Omit<CommissionRow, "userId">;
}

/**
 * Every commission line of a month, quarter or year, per person. Approved months are read
 * from their lines, the others computed from today's deals and rules. Four statements.
 */
export async function commissionReport(
  db: AnyDb,
  input: { period: string; timeZone: string; owners?: readonly string[] },
): Promise<CommissionReport | null> {
  const bounds = periodBounds(input.period, input.timeZone);
  if (!parsePeriodKey(input.period) || !bounds) return null;
  const months = monthKeysOf(input.period);
  const owners = input.owners ?? [];

  const [statements, rules] = await Promise.all([statementsOf(db, months), loadCommissionRules(db)]);
  const approvedMonths = new Set(statements.map((s) => s.period));

  const [paid, unpaid] = await Promise.all([
    statements.length === 0
      ? []
      : db
          .select({
            dealId: commissionLines.dealId,
            dealName: commissionLines.dealName,
            userId: commissionLines.userId,
            wonAt: commissionLines.wonAt,
            base: commissionLines.base,
            ratePercent: commissionLines.ratePercent,
            amount: commissionLines.amount,
            ruleId: commissionLines.ruleId,
            month: commissionStatements.period,
            nowStatus: deals.status,
            nowOwner: deals.ownerId,
            nowBase: dealEur,
            nowId: deals.id,
          })
          .from(commissionLines)
          .innerJoin(commissionStatements, eq(commissionStatements.id, commissionLines.statementId))
          .leftJoin(deals, eq(deals.id, commissionLines.dealId))
          .where(
            and(
              inArray(
                commissionLines.statementId,
                statements.map((s) => s.id),
              ),
              ownerCondition(commissionLines.userId, owners),
            ),
          ),
    unpaidLines(db, { from: bounds.from, to: bounds.to, timeZone: input.timeZone, owners, rules }),
  ]);

  const lines: CommissionLine[] = [
    ...paid.map(
      (l: {
        dealId: string | null;
        dealName: string;
        userId: string | null;
        wonAt: Date;
        base: unknown;
        ratePercent: unknown;
        amount: unknown;
        ruleId: string | null;
        month: string;
        nowStatus: string | null;
        nowOwner: string | null;
        nowBase: unknown;
        nowId: string | null;
      }) => {
        const base = Number(l.base);
        const drift: CommissionDrift | null = !l.nowId
          ? "deleted"
          : l.nowStatus !== "won"
            ? "reopened"
            : l.nowOwner !== l.userId
              ? "owner"
              : Math.abs(Number(l.nowBase) - base) >= 0.005
                ? "amount"
                : null;
        return {
          dealId: l.dealId,
          dealName: l.dealName,
          userId: l.userId,
          wonAt: l.wonAt,
          month: l.month,
          base,
          ratePercent: l.ratePercent === null ? null : Number(l.ratePercent),
          amount: Number(l.amount),
          ruleId: l.ruleId,
          approved: true,
          drift,
          late: false,
        };
      },
    ),
    ...unpaid.map((l) => ({ ...l, late: approvedMonths.has(l.month) })),
  ].sort((a, b) => a.wonAt.getTime() - b.wonAt.getTime());

  const byUser = new Map<string, CommissionRow>();
  for (const l of lines) {
    const key = l.userId ?? UNASSIGNED;
    const row = byUser.get(key) ?? { userId: key, deals: 0, base: 0, amount: 0, approved: 0, unpaid: 0 };
    row.deals++;
    row.base += l.base;
    row.amount += l.amount;
    if (l.approved) row.approved += l.amount;
    if (l.ratePercent === null) row.unpaid++;
    byUser.set(key, row);
  }
  const cents = (n: number) => Math.round(n * 100) / 100;
  const rows = [...byUser.values()]
    .map((r) => ({ ...r, base: cents(r.base), amount: cents(r.amount), approved: cents(r.approved) }))
    // Most earned first; nobody's deals last.
    .sort((a, b) => Number(a.userId === UNASSIGNED) - Number(b.userId === UNASSIGNED) || b.amount - a.amount);
  const totals = rows.reduce(
    (t, r) => ({
      deals: t.deals + r.deals,
      base: cents(t.base + r.base),
      amount: cents(t.amount + r.amount),
      approved: cents(t.approved + r.approved),
      unpaid: t.unpaid + r.unpaid,
    }),
    { deals: 0, base: 0, amount: 0, approved: 0, unpaid: 0 },
  );

  return {
    period: input.period,
    months: months.map((month) => {
      const s = statements.find((x) => x.period === month);
      return { month, approvedAt: s?.approvedAt ?? null, approvedBy: s?.approvedBy ?? null };
    }),
    lines,
    rows,
    totals,
  };
}

export type ApproveResult =
  | { ok: true; statementId: string; lines: number; total: number }
  | { ok: false; reason: "invalid" | "not_over" | "already" };

/**
 * Freezes a month: one line per won deal in it not yet paid, plus the late wins of months
 * already approved, priced by the rules in force on each win's day.
 */
export async function approveCommissionMonth(
  db: AnyDb,
  input: { month: string; timeZone: string; approverId: string | null; now?: Date },
): Promise<ApproveResult> {
  const now = input.now ?? new Date();
  const parsed = parsePeriodKey(input.month);
  const bounds = periodBounds(input.month.trim(), input.timeZone);
  if (!parsed || parsed.kind !== "month" || !bounds) return { ok: false, reason: "invalid" };
  // ⚠️ The key as the reports read it: " 2026-08" parses, and stored as typed its month would
  // be found by no report while its deals, already on its lines, vanished from every one.
  const month = periodKey(parsed);
  if (bounds.to.getTime() > now.getTime()) return { ok: false, reason: "not_over" };

  const [statements, rules] = await Promise.all([statementsOf(db), loadCommissionRules(db)]);
  const approvedMonths = new Set(statements.map((s) => s.period));
  // Late wins can only sit in months already approved, so reading back to the first of
  // them is enough — never the workspace's whole history.
  const earliest = [...approvedMonths]
    .sort()
    .map((m) => periodBounds(m, input.timeZone)?.from)
    .find((d): d is Date => Boolean(d));
  const from = earliest && earliest < bounds.from ? earliest : bounds.from;

  const candidates = await unpaidLines(db, { from, to: bounds.to, timeZone: input.timeZone, rules });
  const lines = candidates.filter((l) => l.month === month || approvedMonths.has(l.month));

  const statementId = crypto.randomUUID();
  const payload = JSON.stringify(
    lines.map((l) => ({
      id: crypto.randomUUID(),
      deal_id: l.dealId,
      deal_name: l.dealName,
      user_id: l.userId,
      rule_id: l.ruleId,
      won_at: l.wonAt.toISOString(),
      base: l.base,
      rate_percent: l.ratePercent,
      amount: l.amount,
    })),
  );
  // ⚠️⚠️ One statement: the month's unique index decides who approves it, and its lines
  // exist only if its row does. Two statements would leave, on a failure between them, a
  // month approved with nothing in it.
  const result = await db.execute(sql`
    with s as (
      insert into commission_statement (id, period, approved_by, approved_at)
      values (${statementId}, ${month}, ${input.approverId}, ${now.toISOString()})
      on conflict (period) do nothing
      returning id
    ), ins as (
      insert into commission_line (id, statement_id, deal_id, deal_name, user_id, rule_id, won_at, base, rate_percent, amount)
      select v.id, s.id, v.deal_id, v.deal_name, v.user_id, v.rule_id, v.won_at, v.base, v.rate_percent, v.amount
      from s, jsonb_to_recordset(${payload}::jsonb) as v(
        id text, deal_id text, deal_name text, user_id text, rule_id text,
        won_at timestamp, base numeric, rate_percent numeric, amount numeric
      )
      on conflict (deal_id) do nothing
      returning amount
    )
    select (select count(*) from s)::int as approved,
           (select count(*) from ins)::int as lines,
           (select coalesce(sum(amount), 0) from ins)::text as total
  `);
  const row = (result.rows ?? result)[0] as { approved: number; lines: number; total: string };
  if (Number(row.approved) === 0) return { ok: false, reason: "already" };
  return { ok: true, statementId, lines: Number(row.lines), total: Number(row.total) };
}

/** Takes a month's approval back: its lines are recomputed from today's deals and rules. */
export async function reopenCommissionMonth(db: AnyDb, month: string): Promise<boolean> {
  const parsed = parsePeriodKey(month);
  if (!parsed || parsed.kind !== "month") return false;
  const gone = await db
    .delete(commissionStatements)
    .where(eq(commissionStatements.period, periodKey(parsed)))
    .returning({ id: commissionStatements.id });
  return gone.length > 0;
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A rule as typed; null when the rate or the day is not one. */
export function readRule(input: {
  userId?: string | null;
  pipelineId?: string | null;
  ratePercent: unknown;
  validFrom: unknown;
}): { userId: string | null; pipelineId: string | null; ratePercent: number; validFrom: string } | null {
  const rate = typeof input.ratePercent === "string" ? Number(input.ratePercent.replace(",", ".")) : input.ratePercent;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) return null;
  if (typeof input.validFrom !== "string" || !DAY.test(input.validFrom)) return null;
  // 2026-02-31 matches the pattern and is not a day.
  const d = new Date(`${input.validFrom}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.validFrom) return null;
  return {
    userId: input.userId || null,
    pipelineId: input.pipelineId || null,
    ratePercent: Math.round(rate * 100) / 100,
    validFrom: input.validFrom,
  };
}

/** Writes a rule; one already starting that day for the same scope takes the new rate. */
export async function saveCommissionRule(
  db: AnyDb,
  rule: { userId: string | null; pipelineId: string | null; ratePercent: number; validFrom: string },
  createdBy: string | null,
): Promise<void> {
  await db.execute(sql`
    insert into commission_rule (id, user_id, pipeline_id, rate_percent, valid_from, created_by)
    values (${crypto.randomUUID()}, ${rule.userId}, ${rule.pipelineId}, ${String(rule.ratePercent)}, ${rule.validFrom}, ${createdBy})
    on conflict (coalesce(user_id, ''), coalesce(pipeline_id, ''), valid_from)
    do update set rate_percent = excluded.rate_percent
  `);
}

/** Months with won deals, unapproved and over, the earliest first: what is waiting. */
export function approvableMonths(report: CommissionReport, now: Date, timeZone: string): string[] {
  return report.months
    .filter((m) => !m.approvedAt)
    .filter((m) => {
      const b = periodBounds(m.month, timeZone);
      return b ? b.to.getTime() <= now.getTime() : false;
    })
    .map((m) => m.month);
}

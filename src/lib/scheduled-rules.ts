import { and, eq, gte, inArray, ne, notInArray } from "drizzle-orm";

import { ruleConditionsHold, runAutomations } from "@/components/crm/automation/rule-engine";
import type { TargetEntity } from "@/components/crm/automation/types";
import { automationLogs, automationRules, deals, leads, orders, tickets } from "@/db/schema";
import { dealSignals, lastActivityByDeal } from "@/lib/deal-signals";

/**
 * Rules that fire when a condition *becomes true with time* — "the close date has passed",
 * "no activity for fourteen days" — checked every morning (§8.1).
 *
 * ⚠️⚠️ Nothing ran scheduled rules (F-10): the old scheduler read the rules once at boot with
 * no workspace, and never ran on Workers. This runs inside the daily job, over every
 * workspace, on a schedule that already exists — so it costs no cron trigger.
 *
 * ⚠️ Two limits keep a morning from turning into a flood. A rule fires for a record at most
 * once a week (`SCHEDULE_COOLDOWN_DAYS`), read from the rule's own log — "no activity for 14
 * days → create a task" must not create a task every day the deal stays quiet. And a run
 * fires at most `SCHEDULE_MAX_RUNS` times per workspace: the job runs every workspace in one
 * request, inside a Worker's subrequest budget.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export const SCHEDULE_COOLDOWN_DAYS = 7;
export const SCHEDULE_MAX_RUNS = 50;
const CANDIDATES = 500;
const DAY_MS = 86_400_000;

/** The records a scheduled rule on `entity` looks at: the live ones, with the figures time changes. */
async function candidates(db: AnyDb, entity: TargetEntity, now: Date): Promise<Record<string, unknown>[]> {
  if (entity === "deal") {
    const last = lastActivityByDeal(db, now);
    const rows = await db
      .select({ deal: deals, lastActivityAt: last.at })
      .from(deals)
      .leftJoin(last, eq(last.dealId, deals.id))
      .where(eq(deals.status, "open"))
      .limit(CANDIDATES);
    return rows.map((r: { deal: Record<string, unknown> & { createdAt: Date }; lastActivityAt: Date | null }) => ({
      ...r.deal,
      idleDays: dealSignals(
        { createdAt: r.deal.createdAt, lastActivityAt: r.lastActivityAt, hasNextStep: false, nextStepAt: null },
        now,
      ).idleDays,
    }));
  }
  if (entity === "lead") return db.select().from(leads).where(eq(leads.isConverted, false)).limit(CANDIDATES);
  if (entity === "ticket") {
    return db
      .select()
      .from(tickets)
      .where(notInArray(tickets.status, ["resolved", "closed"]))
      .limit(CANDIDATES);
  }
  if (entity === "order") return db.select().from(orders).where(ne(orders.status, "cancelled")).limit(CANDIDATES);
  return [];
}

export async function runScheduledRules(
  db: AnyDb,
  now: Date = new Date(),
): Promise<{ checked: number; fired: number }> {
  const active: (typeof automationRules.$inferSelect)[] = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.isActive, true));
  const scheduled = active.filter(
    (r) => Array.isArray(r.triggerOn) && (r.triggerOn as string[]).includes("onSchedule"),
  );
  if (scheduled.length === 0) return { checked: 0, fired: 0 };

  // What already fired this week, per rule and record.
  const since = new Date(now.getTime() - SCHEDULE_COOLDOWN_DAYS * DAY_MS);
  const recent: { ruleId: string; entityId: string }[] = await db
    .select({ ruleId: automationLogs.ruleId, entityId: automationLogs.entityId })
    .from(automationLogs)
    .where(
      and(
        inArray(
          automationLogs.ruleId,
          scheduled.map((r) => r.id),
        ),
        eq(automationLogs.event, "onSchedule"),
        gte(automationLogs.createdAt, since),
      ),
    );
  const fired = new Set(recent.map((r) => `${r.ruleId}:${r.entityId}`));

  let checked = 0;
  let runs = 0;
  const entities = [...new Set(scheduled.map((r) => r.targetEntity as TargetEntity))];
  for (const entity of entities) {
    const rules = scheduled.filter((r) => r.targetEntity === entity);
    for (const record of await candidates(db, entity, now)) {
      if (runs >= SCHEDULE_MAX_RUNS) return { checked, fired: runs };
      checked++;
      const id = String(record.id);
      const due = rules.filter((rule) => {
        if (fired.has(`${rule.id}:${id}`)) return false;
        try {
          return ruleConditionsHold(rule, record, record);
        } catch {
          return false;
        }
      });
      if (due.length === 0) continue;
      await runAutomations({
        entityType: entity,
        entityId: id,
        event: "onSchedule",
        oldData: record,
        newData: record,
        ruleIds: due.map((r) => r.id),
      });
      for (const r of due) fired.add(`${r.id}:${id}`);
      runs++;
    }
  }
  return { checked, fired: runs };
}

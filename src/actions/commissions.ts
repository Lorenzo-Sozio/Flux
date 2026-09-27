"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { commissionRules, pipelines, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { currentPeriodKey, parsePeriodKey, periodKey } from "@/lib/calendar-period";
import {
  approveCommissionMonth,
  commissionReport,
  loadCommissionRules,
  readRule,
  reopenCommissionMonth,
  saveCommissionRule,
} from "@/lib/commissions";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

const PAGE = "/dashboard/pipeline/commissions";

/**
 * The commission report. ⚠️ Whoever may not manage commissions sees their own and nobody
 * else's, whatever the owners filter says: the filter is a view, this is the permission.
 */
export async function getCommissions(input: { period?: string | null; owners?: string[] } = {}) {
  const actor = await requireCapability("record:read");
  const canManage = can(actor, "commission:manage");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const parsed = parsePeriodKey(input.period);
  const period = parsed ? periodKey(parsed) : currentPeriodKey("month", new Date(), timeZone);
  const owners = canManage ? (input.owners ?? []) : [actor.userId];
  const [report, rules] = await Promise.all([
    commissionReport(db, { period, timeZone, owners }),
    canManage ? loadCommissionRules(db) : Promise.resolve([]),
  ]);
  return { report, rules, canManage, timeZone, self: actor.userId };
}

export async function saveCommissionRuleAction(input: {
  userId?: string | null;
  pipelineId?: string | null;
  ratePercent: unknown;
  validFrom: unknown;
}): Promise<{ ok: true } | { ok: false; reason: "invalid" }> {
  const actor = await requireCapability("commission:manage");
  const rule = readRule(input);
  if (!rule) return { ok: false, reason: "invalid" };
  const db = await getDb();
  // A person or a pipeline that is not there is a wrong form, not a 500 from a foreign key.
  const [person, pipeline] = await Promise.all([
    rule.userId ? db.select({ id: users.id }).from(users).where(eq(users.id, rule.userId)) : Promise.resolve([1]),
    rule.pipelineId
      ? db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.id, rule.pipelineId))
      : Promise.resolve([1]),
  ]);
  if (person.length === 0 || pipeline.length === 0) return { ok: false, reason: "invalid" };
  await saveCommissionRule(db, rule, actor.userId);
  revalidatePath(PAGE);
  return { ok: true };
}

/** ⚠️ Changes what months not yet approved pay; approved months keep their lines. */
export async function deleteCommissionRuleAction(id: string): Promise<void> {
  await requireCapability("commission:manage");
  const db = await getDb();
  await db.delete(commissionRules).where(eq(commissionRules.id, id));
  revalidatePath(PAGE);
}

export async function approveCommissionMonthAction(month: string) {
  const actor = await requireCapability("commission:manage");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const result = await approveCommissionMonth(db, { month, timeZone, approverId: actor.userId });
  revalidatePath(PAGE);
  return result;
}

export async function reopenCommissionMonthAction(month: string): Promise<boolean> {
  await requireCapability("commission:manage");
  const reopened = await reopenCommissionMonth(await getDb(), month);
  revalidatePath(PAGE);
  return reopened;
}

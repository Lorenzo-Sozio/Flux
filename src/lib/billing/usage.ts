/**
 * UsageTrackingService — records tenant consumption counters.
 *
 * Counters are per (tenant, metricType, billing period).
 * The period resets monthly, aligned to the subscription's currentPeriodStart.
 * No per-usage billing: data is used only for limit enforcement and reporting.
 */

import { eq, and, gte, lte, sql } from "drizzle-orm";
import { platformDb } from "@/db";
import { billingUsageStats, billingAlerts, billingSubscriptions } from "@/db/schema";
import { getEntitlements } from "./licensing";
import type { PlanLimits } from "./plans-config";
import { USAGE_ALERT_THRESHOLDS } from "./plans-config";

export type MetricType = keyof PlanLimits;

// ─── Period helpers ───────────────────────────────────────────────────────────

function currentPeriodBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

// ─── Increment ────────────────────────────────────────────────────────────────

export async function incrementUsage(
  tenantId: string,
  metric: MetricType,
  amount = 1,
): Promise<number> {
  const { start, end } = currentPeriodBounds();
  const rowId = crypto.randomUUID();

  // Atomic upsert: INSERT … ON CONFLICT DO UPDATE avoids the read-modify-write race
  // that would cause under-counting under concurrent requests.
  const result = await platformDb.execute(
    sql`
      INSERT INTO billing_usage_stat
        (id, tenant_id, metric_type, current_value, period_start, period_end, updated_at)
      VALUES
        (${rowId}, ${tenantId}, ${metric as string}, ${amount}, ${start}, ${end}, NOW())
      ON CONFLICT (tenant_id, metric_type, period_start)
      DO UPDATE SET
        current_value = billing_usage_stat.current_value + ${amount},
        updated_at    = NOW()
      RETURNING current_value
    `,
  );

  const newValue = (result.rows[0] as { current_value: number }).current_value;

  // Fire threshold alerts (non-blocking)
  checkAndSendAlerts(tenantId, metric as string, newValue).catch(() => {});

  return newValue;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getUsage(
  tenantId: string,
  metric: MetricType,
): Promise<{ current: number; limit: number | null; percent: number | null }> {
  const { start } = currentPeriodBounds();

  const row = await platformDb
    .select()
    .from(billingUsageStats)
    .where(
      and(
        eq(billingUsageStats.tenantId, tenantId),
        eq(billingUsageStats.metricType, metric as string),
        gte(billingUsageStats.periodStart, start),
      ),
    )
    .limit(1);

  const current = row[0]?.currentValue ?? 0;
  const ent = await getEntitlements(tenantId);
  const limit = ent.limits[metric as keyof PlanLimits] ?? null;
  const percent = limit !== null ? Math.round((current / limit) * 100) : null;

  return { current, limit, percent };
}

export async function getAllUsage(tenantId: string): Promise<
  Record<
    string,
    { current: number; limit: number | null; percent: number | null }
  >
> {
  const { start } = currentPeriodBounds();

  const rows = await platformDb
    .select()
    .from(billingUsageStats)
    .where(
      and(
        eq(billingUsageStats.tenantId, tenantId),
        gte(billingUsageStats.periodStart, start),
      ),
    );

  const ent = await getEntitlements(tenantId);
  const result: Record<string, { current: number; limit: number | null; percent: number | null }> =
    {};

  for (const row of rows) {
    const limit = ent.limits[row.metricType as keyof PlanLimits] ?? null;
    result[row.metricType] = {
      current: row.currentValue,
      limit,
      percent: limit !== null ? Math.round((row.currentValue / limit) * 100) : null,
    };
  }

  return result;
}

// ─── Threshold alerts ─────────────────────────────────────────────────────────

async function checkAndSendAlerts(
  tenantId: string,
  metric: string,
  currentValue: number,
): Promise<void> {
  const ent = await getEntitlements(tenantId);
  const limit = ent.limits[metric as keyof PlanLimits];
  if (!limit) return;

  const percent = Math.round((currentValue / limit) * 100);
  const { start } = currentPeriodBounds();

  for (const threshold of USAGE_ALERT_THRESHOLDS) {
    if (percent < threshold) continue;

    // Check if this threshold was already sent this period
    const existing = await platformDb
      .select()
      .from(billingAlerts)
      .where(
        and(
          eq(billingAlerts.tenantId, tenantId),
          eq(billingAlerts.metricType, metric),
          eq(billingAlerts.thresholdPercent, threshold),
          gte(billingAlerts.createdAt, start),
        ),
      )
      .limit(1);

    if (existing.length > 0) continue;

    // Record alert (email sending would be wired here)
    await platformDb.insert(billingAlerts).values({
      tenantId,
      metricType: metric,
      thresholdPercent: threshold,
      sentAt: new Date(),
    });
  }
}

// ─── Admin: aggregate usage per tenant ───────────────────────────────────────

export async function getAggregateUsage(tenantId: string): Promise<
  Array<{ metric: string; current: number; limit: number | null; percent: number | null }>
> {
  const usage = await getAllUsage(tenantId);
  return Object.entries(usage).map(([metric, data]) => ({ metric, ...data }));
}

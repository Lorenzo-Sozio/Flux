"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, count, eq, gte, inArray } from "drizzle-orm";

import { createNotificationAction } from "@/actions/auth";
import { dispatchWebhook } from "@/actions/webhooks";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import { activities, companies, contacts, deals, leads, pipelineStages, salesTargets, users } from "@/db/schema";
import { requireAdminAccess, requirePlanLimit, requireWriteAccess } from "@/lib/auth-guard";
import { convertToEur, getExchangeRates } from "@/lib/exchange-rates";
import { getDb } from "@/lib/tenant-context";

export async function getPipelineData() {
  const db = await getDb();
  let stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);

  // Seed default stages if pipeline is completely empty
  if (stages.length === 0) {
    await db.insert(pipelineStages).values([
      { name: "Lead In", order: 1, color: "#94a3b8" },
      { name: "Contact Made", order: 2, color: "#60a5fa" },
      { name: "Meeting Scheduled", order: 3, color: "#fcd34d" },
      { name: "Proposal Sent", order: 4, color: "#fb923c" },
      { name: "Negotiation", order: 5, color: "#f43f5e" },
    ]);
    stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  }

  const allDeals = await db.select().from(deals);

  return { stages, deals: allDeals };
}

export async function createDeal(data: Partial<typeof deals.$inferInsert>) {
  await requireWriteAccess();
  const db = await getDb();
  if (!data.name || !data.stageId) throw new Error("Name and Stage are required.");

  // Enforce the combined maxRecords quota before inserting
  const [[c], [l], [co], [d]] = await Promise.all([
    db.select({ n: count() }).from(contacts),
    db.select({ n: count() }).from(leads),
    db.select({ n: count() }).from(companies),
    db.select({ n: count() }).from(deals),
  ]);
  const totalRecords = Number(c?.n ?? 0) + Number(l?.n ?? 0) + Number(co?.n ?? 0) + Number(d?.n ?? 0);
  await requirePlanLimit("maxRecords", totalRecords);

  // Convert input amount to EUR for storage; record the original input currency
  let amountEur = data.amount ? Number(data.amount) : 0;
  const inputCurrency = (data.currency || "EUR").toUpperCase();
  if (inputCurrency !== "EUR" && amountEur > 0) {
    const { rates } = await getExchangeRates();
    amountEur = convertToEur(amountEur, inputCurrency, rates);
  }

  const payload = {
    ...data,
    amount: String(amountEur),
    currency: inputCurrency,
    status: data.status || "open",
  };

  const [newDeal] = await db
    .insert(deals)
    .values(payload as typeof deals.$inferInsert)
    .returning();
  revalidatePath("/dashboard/pipeline");
  dispatchWebhook("deal.created", {
    id: newDeal.id,
    name: newDeal.name,
    amount: newDeal.amount,
    stageId: newDeal.stageId,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  // Run automation rules after response is sent (zero-latency)
  after(() =>
    runAutomations({
      entityType: "deal",
      entityId: newDeal.id,
      event: "onCreate",
      oldData: {},
      newData: newDeal as Record<string, unknown>,
    }),
  );

  return newDeal;
}

export async function updateDealStage(dealId: string, newStageId: string) {
  await requireWriteAccess();
  const db = await getDb();

  // Capture old state BEFORE the update (needed for "changed" operators)
  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));

  // Auto-set probability based on the destination stage's default
  const [stage] = await db
    .select({ defaultProbability: pipelineStages.defaultProbability })
    .from(pipelineStages)
    .where(eq(pipelineStages.id, newStageId));

  const [updatedDeal] = await db
    .update(deals)
    .set({
      stageId: newStageId,
      probability: stage?.defaultProbability ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(deals.id, dealId))
    .returning();

  dispatchWebhook("deal.stage_changed", {
    id: updatedDeal.id,
    name: updatedDeal.name,
    stageId: newStageId,
    probability: updatedDeal.probability,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  revalidatePath("/dashboard/pipeline");

  after(async () => {
    await refreshDealHealthScore(updatedDeal.id);
    runAutomations({
      entityType: "deal",
      entityId: updatedDeal.id,
      event: "onUpdate",
      oldData: (oldDeal ?? {}) as Record<string, unknown>,
      newData: updatedDeal as Record<string, unknown>,
    });
  });

  return updatedDeal;
}

export async function updateDeal(dealId: string, data: Partial<typeof deals.$inferInsert>) {
  await requireWriteAccess();
  const db = await getDb();

  // Capture old state BEFORE the update
  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));

  // Convert input amount to EUR if a non-EUR currency is provided
  let amountStr: string | undefined;
  if (data.amount !== undefined) {
    const inputCurrency = (data.currency || "EUR").toUpperCase();
    if (inputCurrency !== "EUR") {
      const { rates } = await getExchangeRates();
      amountStr = String(convertToEur(Number(data.amount), inputCurrency, rates));
    } else {
      amountStr = String(data.amount);
    }
  }

  const payload = {
    ...data,
    amount: amountStr,
  };

  const [updatedDeal] = await db
    .update(deals)
    .set(payload as Partial<typeof deals.$inferInsert>)
    .where(eq(deals.id, dealId))
    .returning();
  revalidatePath("/dashboard/pipeline");

  // Fire webhook + notification on deal won/lost
  if (data.status === "won") {
    dispatchWebhook("deal.won", { id: updatedDeal.id, name: updatedDeal.name, amount: updatedDeal.amount }).catch(
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
      () => {},
    );
    if (updatedDeal.ownerId) {
      createNotificationAction({
        userId: updatedDeal.ownerId,
        type: "deal_won",
        title: "Deal won! 🏆",
        message: `"${updatedDeal.name}" has been marked as won.`,
        link: `/dashboard/pipeline`,
        // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
      }).catch(() => {});
    }
  } else if (data.status === "lost") {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    dispatchWebhook("deal.lost", { id: updatedDeal.id, name: updatedDeal.name }).catch(() => {});
  }

  after(async () => {
    await refreshDealHealthScore(updatedDeal.id);
    runAutomations({
      entityType: "deal",
      entityId: updatedDeal.id,
      event: "onUpdate",
      oldData: (oldDeal ?? {}) as Record<string, unknown>,
      newData: updatedDeal as Record<string, unknown>,
    });
  });

  return updatedDeal;
}

// ─── Deal Detail ─────────────────────────────────────────────────────────────

export async function getDealById(dealId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      deal: deals,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      companyName: companies.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
      ownerName: users.name,
    })
    .from(deals)
    .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .leftJoin(companies, eq(deals.companyId, companies.id))
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .leftJoin(users, eq(deals.ownerId, users.id))
    .where(eq(deals.id, dealId));
  return row ?? null;
}

// ─── Pipeline Report ──────────────────────────────────────────────────────────
export async function getPipelineReport() {
  const db = await getDb();
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const allDeals = await db.select().from(deals);
  const now = Date.now();

  const stageReport = stages.map((stage) => {
    const stageDeals = allDeals.filter((d) => d.stageId === stage.id && d.status === "open");
    const totalValue = stageDeals.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    const weightedValue = stageDeals.reduce(
      (sum, d) => sum + Number(d.amount ?? 0) * ((d.probability ?? stage.defaultProbability ?? 0) / 100),
      0,
    );
    const avgDaysInStage = stageDeals.length
      ? Math.round(
          stageDeals.reduce((sum, d) => sum + (now - new Date(d.createdAt).getTime()) / 86_400_000, 0) /
            stageDeals.length,
        )
      : 0;
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      dealCount: stageDeals.length,
      totalValue,
      weightedValue,
      avgDaysInStage,
    };
  });

  const wonDeals = allDeals.filter((d) => d.status === "won");
  const lostDeals = allDeals.filter((d) => d.status === "lost");
  const openDeals = allDeals.filter((d) => d.status === "open");
  const totalWonValue = wonDeals.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const totalPipeline = openDeals.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const winRate =
    wonDeals.length + lostDeals.length > 0
      ? ((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100).toFixed(1)
      : "0";

  return {
    stageReport,
    totalWonValue,
    totalPipeline,
    winRate,
    wonCount: wonDeals.length,
    lostCount: lostDeals.length,
    openCount: openDeals.length,
  };
}

// ── Pipeline Stage Management ────────────────────────────────────────────────

export async function getPipelineStages() {
  const db = await getDb();
  return db.select().from(pipelineStages).orderBy(pipelineStages.order);
}

export async function createPipelineStage(data: { name: string; color?: string; defaultProbability?: number }) {
  await requireAdminAccess();
  const db = await getDb();
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const maxOrder = stages.length > 0 ? Math.max(...stages.map((s) => s.order)) : 0;
  const [stage] = await db
    .insert(pipelineStages)
    .values({
      name: data.name.trim(),
      order: maxOrder + 1,
      color: data.color ?? "#94a3b8",
      defaultProbability: data.defaultProbability ?? 0,
    })
    .returning();
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/settings/pipeline");
  return stage;
}

export async function updatePipelineStage(
  id: string,
  data: { name?: string; color?: string; defaultProbability?: number; order?: number },
) {
  await requireAdminAccess();
  const db = await getDb();
  await db
    .update(pipelineStages)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(pipelineStages.id, id));
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/settings/pipeline");
}

export async function deletePipelineStage(id: string) {
  await requireAdminAccess();
  const db = await getDb();
  const dealsInStage = await db.select().from(deals).where(eq(deals.stageId, id));
  if (dealsInStage.length > 0) {
    throw new Error("Cannot delete a stage with active deals.");
  }
  await db.delete(pipelineStages).where(eq(pipelineStages.id, id));
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/settings/pipeline");
}

export async function getDealsForSelect() {
  const db = await getDb();
  return db.select({ id: deals.id, name: deals.name }).from(deals).orderBy(deals.name);
}

// ── Deal Health Score ─────────────────────────────────────────────────────────

function computeHealthScore(
  deal: {
    probability: number | null;
    expectedCloseDate: Date | null;
    updatedAt: Date;
  },
  recentActivityCount: number,
): number {
  let score = 100;
  const now = new Date();
  const daysSinceUpdated = (now.getTime() - new Date(deal.updatedAt).getTime()) / 86_400_000;

  // Overdue close date
  if (deal.expectedCloseDate && new Date(deal.expectedCloseDate) < now) score -= 35;

  // Stale deal (no update + no recent activity)
  if (recentActivityCount === 0) {
    if (daysSinceUpdated > 14) score -= 35;
    else if (daysSinceUpdated > 7) score -= 20;
  }

  // Stuck in stage (use updatedAt as proxy)
  if (daysSinceUpdated > 60) score -= 25;
  else if (daysSinceUpdated > 30) score -= 12;

  // Low probability
  if ((deal.probability ?? 0) < 20) score -= 15;

  return Math.max(0, Math.min(100, score));
}

async function refreshDealHealthScore(dealId: string) {
  const db = await getDb();
  const [deal] = await db
    .select({
      status: deals.status,
      probability: deals.probability,
      expectedCloseDate: deals.expectedCloseDate,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .where(eq(deals.id, dealId));
  if (!deal || deal.status !== "open") return;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const recentActivities = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.dealId, dealId), gte(activities.createdAt, sevenDaysAgo)))
    .limit(1);

  const score = computeHealthScore(deal, recentActivities.length);
  await db.update(deals).set({ healthScore: score }).where(eq(deals.id, dealId));
}

// ── Forecast ──────────────────────────────────────────────────────────────────

export async function getForecastData() {
  const db = await getDb();
  const openDeals = await db
    .select({
      id: deals.id,
      name: deals.name,
      amount: deals.amount,
      currency: deals.currency,
      probability: deals.probability,
      expectedCloseDate: deals.expectedCloseDate,
      ownerId: deals.ownerId,
      ownerName: users.name,
      stageId: deals.stageId,
      stageName: pipelineStages.name,
    })
    .from(deals)
    .leftJoin(users, eq(deals.ownerId, users.id))
    .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .where(eq(deals.status, "open"));

  // Build monthly buckets for the next 6 months
  const now = new Date();
  const periodKeys: string[] = [];
  const months: {
    label: string;
    year: number;
    month: number;
    period: string;
    committed: number;
    bestCase: number;
    pipeline: number;
    target: number;
  }[] = [];

  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    periodKeys.push(period);
    months.push({
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      year: d.getFullYear(),
      month: d.getMonth(),
      period,
      committed: 0,
      bestCase: 0,
      pipeline: 0,
      target: 0,
    });
  }

  // Fetch monthly targets for this period range
  const targetRows = await db
    .select({ period: salesTargets.period, targetAmount: salesTargets.targetAmount })
    .from(salesTargets)
    .where(inArray(salesTargets.period, periodKeys));

  for (const tr of targetRows) {
    const bucket = months.find((m) => m.period === tr.period);
    if (bucket) bucket.target += parseFloat(tr.targetAmount ?? "0");
  }

  // Single pass: bucket by month and build owner map simultaneously
  const ownerMap = new Map<string, { name: string; weighted: number; dealCount: number }>();
  for (const deal of openDeals) {
    const amt = Number(deal.amount ?? 0);
    const prob = deal.probability ?? 0;
    const weighted = (amt * prob) / 100;

    let bucket = months[months.length - 1];
    if (deal.expectedCloseDate) {
      const cd = new Date(deal.expectedCloseDate);
      const found = months.find((m) => m.year === cd.getFullYear() && m.month === cd.getMonth());
      if (found) bucket = found;
    }
    bucket.pipeline += weighted;
    if (prob >= 50) bucket.bestCase += weighted;
    if (prob >= 80) bucket.committed += weighted;

    if (deal.ownerId) {
      const existing = ownerMap.get(deal.ownerId);
      if (existing) {
        existing.weighted += weighted;
        existing.dealCount += 1;
      } else {
        ownerMap.set(deal.ownerId, { name: deal.ownerName ?? "Unassigned", weighted, dealCount: 1 });
      }
    }
  }

  const currency = openDeals[0]?.currency ?? "EUR";
  // months[0] is always the current month (loop starts at i=0)
  const currentMonthTarget = months[0]?.target ?? 0;

  return {
    months,
    byOwner: [...ownerMap.values()].sort((a, b) => b.weighted - a.weighted),
    currency,
    totalWeighted: months.reduce((s, m) => s + m.pipeline, 0),
    committed: months.reduce((s, m) => s + m.committed, 0),
    bestCase: months.reduce((s, m) => s + m.bestCase, 0),
    currentMonthTarget,
  };
}

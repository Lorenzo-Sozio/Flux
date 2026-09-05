"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, count, eq, gte, inArray } from "drizzle-orm";

import { createNotificationAction } from "@/actions/auth";
import { dispatchWebhook } from "@/actions/webhooks";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import {
  activities,
  companies,
  contacts,
  dealLossReasons,
  deals,
  leads,
  pipelineStages,
  salesTargets,
  users,
} from "@/db/schema";
import { DEFAULT_STAGES } from "@/db/seed-workspace";
import { requireAdminAccess, requireCapability, requirePlanLimit, requireWriteAccess } from "@/lib/auth-guard";
import { convertToEur, getExchangeRates } from "@/lib/exchange-rates";
import { getDb } from "@/lib/tenant-context";

export async function getPipelineData() {
  await requireCapability("record:read");
  const db = await getDb();
  let stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);

  // Seed default stages if pipeline is completely empty.
  //
  // This used to write its own five stages, none of them marked won or lost, so
  // a workspace that first reached the pipeline through this path got a board
  // with no way to close anything. It now uses the same defaults every other
  // path seeds (audit rilievo U-12).
  if (stages.length === 0) {
    await db.insert(pipelineStages).values(DEFAULT_STAGES);
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

/**
 * What a deal carries when it is lost.
 *
 * `lossReasonId` is the part that aggregates; the note is for the detail a list
 * cannot hold, and the competitor for the question every sales meeting asks
 * (audit rilievo S-09).
 */
export interface LossDetails {
  lossReasonId?: string | null;
  lostCompetitor?: string | null;
  note?: string | null;
}

export async function updateDealStage(dealId: string, newStageId: string, loss?: LossDetails) {
  await requireWriteAccess();
  const db = await getDb();

  // Capture old state BEFORE the update (needed for "changed" operators)
  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));

  const [stage] = await db
    .select({
      defaultProbability: pipelineStages.defaultProbability,
      isWon: pipelineStages.isWon,
      isLost: pipelineStages.isLost,
    })
    .from(pipelineStages)
    .where(eq(pipelineStages.id, newStageId));

  const [oldStage] = oldDeal?.stageId
    ? await db
        .select({ defaultProbability: pipelineStages.defaultProbability })
        .from(pipelineStages)
        .where(eq(pipelineStages.id, oldDeal.stageId))
    : [undefined];

  // The stage default used to be written unconditionally, so a rep who had set
  // 65% by hand lost it every time the card moved. It is now applied only when the
  // current value is still whatever the previous stage suggested (audit rilievo C-06).
  const currentProbability = oldDeal?.probability ?? null;
  const probabilityWasManual =
    currentProbability !== null && currentProbability !== (oldStage?.defaultProbability ?? 0);

  // Dragging a card into the "Won" column changed the stage and left status at
  // "open", so the deal kept weighing on the forecast for ever. Terminal stages
  // now close the deal, and record when.
  const closing = stage?.isWon ? "won" : stage?.isLost ? "lost" : null;
  const now = new Date();

  // Where the conversation actually stopped. Not derivable afterwards: the move
  // about to happen overwrites `stageId` with the "Lost" column itself.
  const lostFields =
    closing === "lost"
      ? {
          lostAtStageId: oldDeal?.stageId ?? null,
          ...(loss?.lossReasonId !== undefined ? { lossReasonId: loss.lossReasonId } : {}),
          ...(loss?.lostCompetitor !== undefined ? { lostCompetitor: loss.lostCompetitor } : {}),
          ...(loss?.note !== undefined ? { lostReason: loss.note } : {}),
        }
      : {};

  const [updatedDeal] = await db
    .update(deals)
    .set({
      stageId: newStageId,
      probability: probabilityWasManual ? currentProbability : (stage?.defaultProbability ?? 0),
      ...(closing ? { status: closing, closedAt: now } : {}),
      ...lostFields,
      updatedAt: now,
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

  // A deal closed by a drag is closed for the same reasons as one closed from the
  // form, and integrations must hear about it either way.
  if (closing && oldDeal?.status !== closing) {
    dispatchWebhook(closing === "won" ? "deal.won" : "deal.lost", {
      id: updatedDeal.id,
      name: updatedDeal.name,
      amount: updatedDeal.amount,
      currency: updatedDeal.currency,
      // Why it was lost travels with the event, or there is no win/loss analysis
      // downstream either.
      ...(closing === "lost"
        ? {
            lossReasonId: updatedDeal.lossReasonId,
            competitor: updatedDeal.lostCompetitor,
            note: updatedDeal.lostReason,
          }
        : {}),
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});
  }

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

  // Record WHEN a deal closed. "Won this month" was derived from updatedAt, so
  // re-saving an old deal moved it into the current month's revenue, and the
  // number people are measured on drifted (audit rilievo C-07).
  const isClosing = (data.status === "won" || data.status === "lost") && oldDeal?.status !== data.status;
  const isReopening = data.status === "open" && oldDeal?.status !== "open";

  const payload = {
    ...data,
    amount: amountStr,
    ...(isClosing ? { closedAt: new Date() } : {}),
    ...(isReopening ? { closedAt: null, lostReason: null } : {}),
  };

  const [updatedDeal] = await db
    .update(deals)
    .set(payload as Partial<typeof deals.$inferInsert>)
    .where(eq(deals.id, dealId))
    .returning();
  revalidatePath("/dashboard/pipeline");

  // Only on the transition. Passing status: "won" on any later edit re-fired the
  // event and re-notified the owner, so an integration saw the same deal won
  // several times.
  if (data.status === "won" && isClosing) {
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
  } else if (data.status === "lost" && isClosing) {
    dispatchWebhook("deal.lost", {
      id: updatedDeal.id,
      name: updatedDeal.name,
      amount: updatedDeal.amount,
      // Why it was lost travels with the event: without it there is no win/loss
      // analysis anywhere, here or downstream.
      reason: updatedDeal.lostReason,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});
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
  await requireCapability("record:read");
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
  await requireCapability("report:read");
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
  await requireCapability("record:read");
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
  await requireCapability("record:read");
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
  await requireCapability("report:read");
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
      label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
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

  // Deals that do not belong to any of the six months.
  //
  // Both of these used to be dumped into the LAST bucket, so a future month
  // appeared inflated with dead pipeline and deals whose close date had already
  // passed were presented as revenue six months out (audit rilievo C-08). They are
  // now reported separately, because each is a list of work rather than a forecast:
  // one needs a date, the other needs a decision.
  const unscheduled = { count: 0, weighted: 0, total: 0 };
  const overdue = { count: 0, weighted: 0, total: 0 };
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Single pass: bucket by month and build owner map simultaneously
  const ownerMap = new Map<string, { name: string; weighted: number; dealCount: number }>();
  for (const deal of openDeals) {
    const amt = Number(deal.amount ?? 0);
    const prob = deal.probability ?? 0;
    const weighted = (amt * prob) / 100;

    let bucket: (typeof months)[number] | null = null;
    if (!deal.expectedCloseDate) {
      unscheduled.count += 1;
      unscheduled.weighted += weighted;
      unscheduled.total += amt;
    } else {
      const cd = new Date(deal.expectedCloseDate);
      const found = months.find((m) => m.year === cd.getFullYear() && m.month === cd.getMonth());
      if (found) {
        bucket = found;
      } else if (cd < startOfCurrentMonth) {
        overdue.count += 1;
        overdue.weighted += weighted;
        overdue.total += amt;
      } else {
        // Genuinely beyond the horizon: counted, but not folded into month six.
        unscheduled.count += 1;
        unscheduled.weighted += weighted;
        unscheduled.total += amt;
      }
    }

    if (bucket) {
      bucket.pipeline += weighted;
      // "Best case" and "committed" are the full value of the deals that qualify,
      // not the probability-weighted value. Weighting them as well discounted the
      // two lines management reads twice over.
      if (prob >= 50) bucket.bestCase += amt;
      if (prob >= 80) bucket.committed += amt;
    }

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

  // Amounts are stored in EUR, so the figures are EUR. Labelling them with the
  // currency of whichever deal happened to be first in the list presented euro
  // totals as dollars (audit rilievo C-08).
  const currency = "EUR";
  // months[0] is always the current month (loop starts at i=0)
  const currentMonthTarget = months[0]?.target ?? 0;

  return {
    months,
    unscheduled,
    overdue,
    byOwner: [...ownerMap.values()].sort((a, b) => b.weighted - a.weighted),
    currency,
    totalWeighted: months.reduce((s, m) => s + m.pipeline, 0),
    committed: months.reduce((s, m) => s + m.committed, 0),
    bestCase: months.reduce((s, m) => s + m.bestCase, 0),
    currentMonthTarget,
  };
}

// ─── Why deals are lost ───────────────────────────────────────────────────────

/**
 * The reasons this workspace can pick from.
 *
 * Retired reasons are kept, not deleted: removing one from the list must not
 * erase itself from the deals already closed under it.
 */
export async function getLossReasons(includeRetired = false) {
  await requireCapability("record:read");
  const db = await getDb();
  const rows = await db.select().from(dealLossReasons).orderBy(dealLossReasons.order, dealLossReasons.name);
  return includeRetired ? rows : rows.filter((r) => r.isActive);
}

export async function createLossReason(name: string) {
  await requireAdminAccess();
  const db = await getDb();
  const clean = name.trim();
  if (!clean) throw new Error("A reason needs a name.");

  const [{ n }] = await db.select({ n: count() }).from(dealLossReasons);
  const [row] = await db
    .insert(dealLossReasons)
    .values({ name: clean, order: Number(n) + 1 })
    .returning();
  revalidatePath("/dashboard/settings/pipeline");
  return row;
}

export async function updateLossReason(id: string, data: { name?: string; isActive?: boolean; order?: number }) {
  await requireAdminAccess();
  const db = await getDb();
  const [row] = await db
    .update(dealLossReasons)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
    })
    .where(eq(dealLossReasons.id, id))
    .returning();
  revalidatePath("/dashboard/settings/pipeline");
  return row;
}

/**
 * Closes a deal as lost, with the reason attached.
 *
 * Separate from `updateDeal` because losing a deal is not an edit: it is the end
 * of the arc, and the one moment at which the reason is still known. Asked for
 * later, nobody remembers.
 */
export async function loseDeal(dealId: string, loss: LossDetails) {
  await requireWriteAccess();
  const db = await getDb();

  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!oldDeal) throw new Error("Deal not found.");
  if (oldDeal.status === "lost") throw new Error("This deal is already closed as lost.");

  // Move it to the losing column if the pipeline has one, so the board agrees
  // with the record. A pipeline without one still closes the deal.
  const [lostStage] = await db.select().from(pipelineStages).where(eq(pipelineStages.isLost, true)).limit(1);

  if (lostStage) return updateDealStage(dealId, lostStage.id, loss);

  const now = new Date();
  const [updated] = await db
    .update(deals)
    .set({
      status: "lost",
      closedAt: now,
      lostAtStageId: oldDeal.stageId,
      lossReasonId: loss.lossReasonId ?? null,
      lostCompetitor: loss.lostCompetitor ?? null,
      lostReason: loss.note ?? null,
      updatedAt: now,
    })
    .where(eq(deals.id, dealId))
    .returning();

  dispatchWebhook("deal.lost", {
    id: updated.id,
    name: updated.name,
    amount: updated.amount,
    currency: updated.currency,
    lossReasonId: updated.lossReasonId,
    competitor: updated.lostCompetitor,
    note: updated.lostReason,
  });

  revalidatePath("/dashboard/pipeline");
  return updated;
}

/**
 * Win/loss, cut the three ways the question is actually asked.
 *
 * By reason, so the pattern is visible; by the stage where it stopped, which says
 * whether the problem is qualification or closing; and by competitor, which is
 * what every sales meeting asks first. All three carry value, not just counts,
 * because ten small losses and one large one are different problems.
 */
export async function getWinLossAnalysis(sinceDays = 365) {
  await requireCapability("report:read");
  const db = await getDb();
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const closed = await db
    .select({
      id: deals.id,
      status: deals.status,
      amount: deals.amount,
      closedAt: deals.closedAt,
      lossReasonId: deals.lossReasonId,
      lostCompetitor: deals.lostCompetitor,
      lostAtStageId: deals.lostAtStageId,
    })
    .from(deals)
    .where(and(inArray(deals.status, ["won", "lost"]), gte(deals.closedAt, since)));

  const [reasons, stages] = await Promise.all([
    db.select().from(dealLossReasons),
    db.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages),
  ]);
  const reasonName = new Map(reasons.map((r) => [r.id, r.name]));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const won = closed.filter((d) => d.status === "won");
  const lost = closed.filter((d) => d.status === "lost");
  const value = (rows: typeof closed) => rows.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  /** Groups losses by a key, keeping both the count and the money. */
  const groupLosses = (keyOf: (d: (typeof closed)[number]) => string) => {
    const buckets = new Map<string, { key: string; count: number; value: number }>();
    for (const d of lost) {
      const key = keyOf(d);
      const bucket = buckets.get(key) ?? { key, count: 0, value: 0 };
      bucket.count += 1;
      bucket.value += Number(d.amount ?? 0);
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => b.value - a.value || b.count - a.count);
  };

  return {
    wonCount: won.length,
    lostCount: lost.length,
    wonValue: value(won),
    lostValue: value(lost),
    // Of everything that actually closed. Open deals are not a loss yet, and
    // counting them as one is how a win rate quietly becomes meaningless.
    winRate: closed.length ? Math.round((won.length / closed.length) * 100) : 0,
    byReason: groupLosses((d) => (d.lossReasonId ? (reasonName.get(d.lossReasonId) ?? "Unknown") : "Not recorded")),
    byStage: groupLosses((d) => (d.lostAtStageId ? (stageName.get(d.lostAtStageId) ?? "Unknown") : "Not recorded")),
    byCompetitor: groupLosses((d) => d.lostCompetitor?.trim() || "None named"),
  };
}

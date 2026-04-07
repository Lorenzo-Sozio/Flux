"use server";

import { db } from "@/db";
import { deals, pipelineStages } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { dispatchWebhook } from "@/actions/webhooks";
import { createNotificationAction } from "@/actions/auth";

export async function getPipelineData() {
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
  if (!data.name || !data.stageId) throw new Error("Name and Stage are required.");
  
  const payload = {
    ...data,
    amount: data.amount ? String(data.amount) : "0",
    currency: data.currency || "EUR",
    status: data.status || "open",
  };

  const [newDeal] = await db.insert(deals).values(payload as any).returning();
  revalidatePath("/dashboard/pipeline");
  dispatchWebhook("deal.created", { id: newDeal.id, name: newDeal.name, amount: newDeal.amount, stageId: newDeal.stageId }).catch(() => {});
  return newDeal;
}

export async function updateDealStage(dealId: string, newStageId: string) {
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
  }).catch(() => {});

  revalidatePath("/dashboard/pipeline");
  return updatedDeal;
}

export async function updateDeal(dealId: string, data: Partial<typeof deals.$inferInsert>) {
  const payload = {
    ...data,
    amount: data.amount ? String(data.amount) : undefined,
  };

  const [updatedDeal] = await db
    .update(deals)
    .set(payload as any)
    .where(eq(deals.id, dealId))
    .returning();
  revalidatePath("/dashboard/pipeline");

  // Fire webhook + notification on deal won/lost
  if (data.status === "won") {
    dispatchWebhook("deal.won", { id: updatedDeal.id, name: updatedDeal.name, amount: updatedDeal.amount }).catch(() => {});
    if (updatedDeal.ownerId) {
      createNotificationAction({ userId: updatedDeal.ownerId, type: "deal_won", title: "Deal won! 🏆", message: `"${updatedDeal.name}" has been marked as won.`, link: `/dashboard/pipeline` }).catch(() => {});
    }
  } else if (data.status === "lost") {
    dispatchWebhook("deal.lost", { id: updatedDeal.id, name: updatedDeal.name }).catch(() => {});
  }

  return updatedDeal;
}

// ─── Pipeline Report ──────────────────────────────────────────────────────────
export async function getPipelineReport() {
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const allDeals = await db.select().from(deals);
  const now = Date.now();

  const stageReport = stages.map((stage) => {
    const stageDeals = allDeals.filter((d) => d.stageId === stage.id && d.status === "open");
    const totalValue = stageDeals.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    const weightedValue = stageDeals.reduce(
      (sum, d) => sum + Number(d.amount ?? 0) * ((d.probability ?? stage.defaultProbability ?? 0) / 100),
      0
    );
    const avgDaysInStage = stageDeals.length
      ? Math.round(
          stageDeals.reduce((sum, d) => sum + (now - new Date(d.createdAt).getTime()) / 86_400_000, 0) /
            stageDeals.length
        )
      : 0;
    return { id: stage.id, name: stage.name, color: stage.color, dealCount: stageDeals.length, totalValue, weightedValue, avgDaysInStage };
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

  return { stageReport, totalWonValue, totalPipeline, winRate, wonCount: wonDeals.length, lostCount: lostDeals.length, openCount: openDeals.length };
}

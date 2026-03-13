"use server";

import { db } from "@/db";
import { deals, pipelineStages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
  return newDeal;
}

export async function updateDealStage(dealId: string, newStageId: string) {
  const [updatedDeal] = await db
    .update(deals)
    .set({ stageId: newStageId })
    .where(eq(deals.id, dealId))
    .returning();
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
  return updatedDeal;
}

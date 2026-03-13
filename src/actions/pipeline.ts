"use server";

import { db } from "@/db";
import { deals, pipelineStages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getPipelineData() {
  const stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  const allDeals = await db.select().from(deals);
  
  return { stages, deals: allDeals };
}

export async function createDeal(data: Partial<typeof deals.$inferInsert>) {
  if (!data.name || !data.stageId) throw new Error("Name and Stage are required.");
  const [newDeal] = await db.insert(deals).values(data as any).returning();
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
  const [updatedDeal] = await db
    .update(deals)
    .set(data)
    .where(eq(deals.id, dealId))
    .returning();
  revalidatePath("/dashboard/pipeline");
  return updatedDeal;
}

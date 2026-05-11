"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAllUsersAction } from "@/actions/auth";
import { requireAdminAccess } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";
import { salesTargets } from "@/db/schema";

export { getAllUsersAction as getAllUsers };

// ── Schema ────────────────────────────────────────────────────────────────────

const upsertSchema = z.object({
  userId: z.string().min(1),
  period: z.string().min(1), // "2026-05" | "2026-Q2"
  periodType: z.enum(["month", "quarter", "year"]).default("month"),
  targetAmount: z.coerce.number().min(0),
  targetDeals: z.coerce.number().int().min(0).optional().nullable(),
  currency: z.string().default("EUR"),
});

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getSalesTargets(period?: string) {
  const db = await getDb();
  return db.query.salesTargets.findMany({
    where: period ? eq(salesTargets.period, period) : undefined,
    with: { user: true },
    orderBy: salesTargets.period,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function upsertSalesTarget(data: z.infer<typeof upsertSchema>) {
  await requireAdminAccess();
  const db = await getDb();
  const v = upsertSchema.parse(data);

  await db
    .insert(salesTargets)
    .values({
      userId: v.userId,
      period: v.period,
      periodType: v.periodType,
      targetAmount: String(v.targetAmount),
      targetDeals: v.targetDeals ?? null,
      currency: v.currency,
    })
    .onConflictDoUpdate({
      target: [salesTargets.userId, salesTargets.period],
      set: {
        targetAmount: String(v.targetAmount),
        targetDeals: v.targetDeals ?? null,
        currency: v.currency,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/dashboard/settings/targets");
  revalidatePath("/dashboard/pipeline/forecast");
}

export async function deleteSalesTarget(id: string) {
  await requireAdminAccess();
  const db = await getDb();
  await db.delete(salesTargets).where(eq(salesTargets.id, id));
  revalidatePath("/dashboard/settings/targets");
  revalidatePath("/dashboard/pipeline/forecast");
}

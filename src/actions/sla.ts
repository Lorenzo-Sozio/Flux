"use server";

import { db } from "@/db";
import { slas } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdminAccess } from "@/lib/auth-guard";
import { revalidatePath } from "next/cache";
import { SlaSchema } from "@/actions/sla-validation";

export async function getAllSlas() {
  await requireAdminAccess();
  return db.query.slas.findMany({ orderBy: (s, { asc }) => [asc(s.priority), asc(s.name)] });
}

export async function createSlaAction(data: z.infer<typeof SlaSchema>) {
  await requireAdminAccess();
  const validated = SlaSchema.parse(data);
  await db.insert(slas).values(validated);
  revalidatePath("/dashboard/settings/sla");
}

export async function updateSlaAction(id: string, data: z.infer<typeof SlaSchema>) {
  await requireAdminAccess();
  const validated = SlaSchema.parse(data);
  await db.update(slas).set(validated).where(eq(slas.id, id));
  revalidatePath("/dashboard/settings/sla");
}

export async function deleteSlaAction(id: string) {
  await requireAdminAccess();
  await db.delete(slas).where(eq(slas.id, id));
  revalidatePath("/dashboard/settings/sla");
}

export async function toggleSlaAction(id: string, isActive: boolean) {
  await requireAdminAccess();
  await db.update(slas).set({ isActive }).where(eq(slas.id, id));
  revalidatePath("/dashboard/settings/sla");
}

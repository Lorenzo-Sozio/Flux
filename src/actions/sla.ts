"use server";

import { revalidatePath } from "next/cache";

import { asc, eq } from "drizzle-orm";
import type { z } from "zod";

import { SlaSchema } from "@/actions/sla-validation";
import { slas } from "@/db/schema";
import { requireAdminAccess, requirePlanModule } from "@/lib/auth-guard";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

export async function getAllSlas() {
  await requireAdminAccess();
  await requirePlanModule("support");
  const db = await getDb();

  // ⚠️ `findMany` names every column the schema declares, including the two that
  // arrive with migrations 0007 and 0009 — and a tenant database is migrated by
  // hand, after the deploy. Reading the whole row took the SLA settings page down
  // on any workspace that had not pressed the button, which is the page you would
  // go to in order to notice.
  //
  // The old columns are read plainly; the new pair falls back to its defaults, so
  // the page renders and says the feature is not available yet rather than
  // failing.
  const base = await db
    .select({
      id: slas.id,
      name: slas.name,
      description: slas.description,
      priority: slas.priority,
      firstResponseTimeMinutes: slas.firstResponseTimeMinutes,
      resolutionTimeMinutes: slas.resolutionTimeMinutes,
      isActive: slas.isActive,
      createdAt: slas.createdAt,
    })
    .from(slas)
    .orderBy(asc(slas.priority), asc(slas.name));

  const extras = await tolerateUnmigrated(
    "SLA working hours and escalation",
    async () => {
      const rows = await db
        .select({ id: slas.id, useBusinessHours: slas.useBusinessHours, escalationGroupId: slas.escalationGroupId })
        .from(slas);
      return new Map(rows.map((r) => [r.id, r]));
    },
    new Map<string, { id: string; useBusinessHours: boolean; escalationGroupId: string | null }>(),
  );

  return base.map((row) => ({
    ...row,
    useBusinessHours: extras.get(row.id)?.useBusinessHours ?? false,
    escalationGroupId: extras.get(row.id)?.escalationGroupId ?? null,
  }));
}

export async function createSlaAction(data: z.infer<typeof SlaSchema>) {
  await requireAdminAccess();
  await requirePlanModule("support");
  const db = await getDb();
  const validated = SlaSchema.parse(data);
  await db.insert(slas).values(validated);
  revalidatePath("/dashboard/support/sla");
}

export async function updateSlaAction(id: string, data: z.infer<typeof SlaSchema>) {
  await requireAdminAccess();
  await requirePlanModule("support");
  const db = await getDb();
  const validated = SlaSchema.parse(data);
  await db.update(slas).set(validated).where(eq(slas.id, id));
  revalidatePath("/dashboard/support/sla");
}

export async function deleteSlaAction(id: string) {
  await requireAdminAccess();
  await requirePlanModule("support");
  const db = await getDb();
  await db.delete(slas).where(eq(slas.id, id));
  revalidatePath("/dashboard/support/sla");
}

export async function toggleSlaAction(id: string, isActive: boolean) {
  await requireAdminAccess();
  await requirePlanModule("support");
  const db = await getDb();
  await db.update(slas).set({ isActive }).where(eq(slas.id, id));
  revalidatePath("/dashboard/support/sla");
}

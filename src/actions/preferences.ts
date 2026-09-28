"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { userPreferences } from "@/db/schema";
import { requireActor } from "@/lib/auth-guard";
import { getEntitlements } from "@/lib/billing/licensing";
import {
  availableDashboards,
  type DashboardAccess,
  defaultDashboard,
  type HomeDashboard,
  parseHomeDashboard,
} from "@/lib/home-dashboards";
import { can } from "@/lib/permissions";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

/** What decides which dashboards this person may open. */
async function accessOf(actor: Awaited<ReturnType<typeof requireActor>>): Promise<DashboardAccess> {
  const tenantId = await getCurrentTenantId();
  const modules = tenantId
    ? await getEntitlements(tenantId).then(
        (e) => e.enabledModules,
        () => undefined,
      )
    : undefined;
  // No entitlements read is no module withheld, as the home's cards have always assumed.
  const has = (m: string) => !modules || (modules as readonly string[]).includes(m);
  return {
    readsReports: can(actor, "report:read"),
    managesSettings: can(actor, "settings:manage"),
    managesEveryRecord: can(actor, "record:manageAny"),
    hasSales: has("sales"),
    hasSupport: has("support"),
  };
}

/**
 * The home dashboard: this person's saved choice, what they may open, and the default.
 *
 * ⚠️ A workspace whose database is behind the code (0058 not yet applied) reads as no
 * choice made, never as a home page that does not load.
 */
export async function getHomeDashboardSetting(): Promise<{
  saved: HomeDashboard | null;
  available: HomeDashboard[];
  fallback: HomeDashboard;
  access: DashboardAccess;
}> {
  const actor = await requireActor();
  const db = await getDb();
  const [access, row] = await Promise.all([
    accessOf(actor),
    tolerateUnmigrated(
      "user_preference",
      () =>
        db
          .select({ homeDashboard: userPreferences.homeDashboard })
          .from(userPreferences)
          .where(eq(userPreferences.userId, actor.userId))
          .then((rows: { homeDashboard: string | null }[]) => rows[0] ?? null),
      null,
    ),
  ]);
  return {
    saved: parseHomeDashboard(row?.homeDashboard),
    available: availableDashboards(access),
    fallback: defaultDashboard(access),
    access,
  };
}

/**
 * Saves the dashboard the home opens on. Anyone may choose their own, among those they
 * can open; `null` goes back to the default for their role.
 */
export async function setHomeDashboard(value: string | null): Promise<{ ok: boolean }> {
  const actor = await requireActor();
  const chosen = value === null ? null : parseHomeDashboard(value);
  if (value !== null) {
    if (!chosen || !availableDashboards(await accessOf(actor)).includes(chosen)) return { ok: false };
  }
  const db = await getDb();
  await db
    .insert(userPreferences)
    .values({ userId: actor.userId, homeDashboard: chosen, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { homeDashboard: chosen, updatedAt: new Date() },
    });
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/profile");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getLocale } from "next-intl/server";

import { platformDb } from "@/db";
import { tenantMembers, userInvitations } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { ONBOARDING_KEYS, type OnboardingState, readOnboarding, setOnboardingFlag } from "@/lib/onboarding";
import { can } from "@/lib/permissions";
import { loadSampleData, removeSampleData, sampleDependents } from "@/lib/sample-data";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

/**
 * The first-run card on the home page (src/lib/onboarding.ts) and its sample data
 * (src/lib/sample-data.ts). Every step is a workspace setting, so it is for whoever
 * manages the workspace; everybody else gets no card rather than a list they cannot act on.
 */

export async function getOnboarding(): Promise<(OnboardingState & { dependents: number }) | null> {
  const actor = await requireCapability("record:read");
  if (!can(actor, "settings:manage")) return null;
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;
  const db = await getDb();

  // Membership and invitations are the registry's, not this database's.
  const [[members], [pending]] = await Promise.all([
    platformDb.select({ n: count() }).from(tenantMembers).where(eq(tenantMembers.tenantId, tenantId)),
    platformDb
      .select({ n: count() })
      .from(userInvitations)
      .where(
        and(
          eq(userInvitations.tenantId, tenantId),
          isNull(userInvitations.acceptedAt),
          gt(userInvitations.expiresAt, new Date()),
        ),
      ),
  ]);
  const state = await readOnboarding(db, {
    members: Number(members?.n ?? 0),
    pendingInvitations: Number(pending?.n ?? 0),
  });
  return { ...state, dependents: state.sample ? await sampleDependents(db) : 0 };
}

export async function loadSampleDataAction(): Promise<
  { ok: true } | { ok: false; reason: "notEmpty" | "alreadyLoaded" | "noStages" }
> {
  const actor = await requireCapability("settings:manage");
  const result = await loadSampleData(await getDb(), { ownerId: actor.userId, locale: await getLocale() });
  if (result.ok) revalidatePath("/dashboard", "layout");
  return result;
}

export async function removeSampleDataAction(): Promise<{ ok: true }> {
  await requireCapability("settings:manage");
  await removeSampleData(await getDb());
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** "The default stages are right for us": the one step that looking at can complete. */
export async function confirmStagesAction(): Promise<{ ok: true }> {
  await requireCapability("settings:manage");
  await setOnboardingFlag(await getDb(), ONBOARDING_KEYS.stagesReviewed, true);
  revalidatePath("/dashboard/crm");
  return { ok: true };
}

export async function dismissOnboardingAction(): Promise<{ ok: true }> {
  await requireCapability("settings:manage");
  await setOnboardingFlag(await getDb(), ONBOARDING_KEYS.dismissed, true);
  revalidatePath("/dashboard/crm");
  return { ok: true };
}

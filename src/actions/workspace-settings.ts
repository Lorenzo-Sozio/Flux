"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { businessCalendar } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { FALLBACK_CALENDAR } from "@/lib/business-calendar";
import type { BrandIdentity } from "@/lib/email-brand";
import { getTenantById } from "@/lib/get-tenant";
import type { ApprovalPolicy } from "@/lib/quote-status";
import { getStorage, newStorageKey } from "@/lib/storage";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { WORKSPACE_FEATURES, type WorkspaceFeature, writeWorkspaceFeature } from "@/lib/workspace-features";
import {
  cleanApprovalPolicy,
  cleanQuoteDefaults,
  LOGO_MAX_BYTES,
  logoTypeOf,
  type QuoteDefaults,
  readApprovalPolicy,
  readBrandIdentity,
  readLogoRef,
  readQuoteDefaults,
  writeApprovalPolicy,
  writeBrandIdentity,
  writeLogoRef,
  writeQuoteDefaults,
} from "@/lib/workspace-preferences";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

/**
 * Switches an optional part of the product on or off for the whole workspace.
 *
 * An administrator's decision: it changes what everybody's menu shows.
 */
export async function setWorkspaceFeatureAction(feature: WorkspaceFeature, on: boolean): Promise<void> {
  await requireCapability("settings:manage");
  if (!WORKSPACE_FEATURES.includes(feature)) throw new Error(`Unknown feature: ${feature}`);
  await writeWorkspaceFeature(await getDb(), feature, on === true);
  // Every page's menu, and the chat widget in the layout, read it.
  revalidatePath("/dashboard", "layout");
}

// ── Settings → General ────────────────────────────────────────────────────────

export async function getGeneralSettings(): Promise<{
  timeZone: string;
  quoteDefaults: QuoteDefaults;
  hasLogo: boolean;
  approval: ApprovalPolicy;
  brand: BrandIdentity;
}> {
  await requireCapability("settings:manage");
  const db = await getDb();
  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  const [timeZone, quoteDefaults, logo, approval, brand] = await Promise.all([
    getWorkspaceTimeZone(),
    readQuoteDefaults(db),
    readLogoRef(db),
    readApprovalPolicy(db, tenant?.settings),
    readBrandIdentity(db),
  ]);
  return { timeZone, quoteDefaults, hasLogo: Boolean(logo), approval, brand };
}

/**
 * The identity every email to a customer carries (src/lib/email-brand.ts): the colour of its
 * buttons and details, the website and the social pages in the signatures. Whatever cannot be
 * used — a colour that is not one, a link that is not http(s) — is dropped, not stored.
 */
export async function saveBrandIdentityAction(input: BrandIdentity): Promise<BrandIdentity> {
  await requireCapability("settings:manage");
  const saved = await writeBrandIdentity(await getDb(), input);
  revalidatePath("/dashboard/settings/general");
  revalidatePath("/dashboard/profile");
  return saved;
}

/** Above which discount or total a quote needs approval before it leaves (§7.5). */
export async function saveApprovalPolicyAction(input: { maxDiscountPercent: number; maxTotalAmount: number }) {
  await requireCapability("settings:manage");
  const clean = cleanApprovalPolicy(input);
  await writeApprovalPolicy(await getDb(), clean);
  revalidatePath("/dashboard/settings/general");
  return clean;
}

/**
 * The workspace's clock.
 *
 * ⚠️⚠️ It governs the calendar, reminders, "today" everywhere and every date in the reports
 * — and it could only be set from Support → SLA → Opening hours, behind the support module
 * and `sla:manage`. A workspace without support could not change it at all. Same row as
 * before (`business_calendar`), so a zone already set there is the one shown here.
 */
export async function saveWorkspaceTimeZoneAction(timeZone: string): Promise<{ ok: boolean }> {
  await requireCapability("settings:manage");
  const zone = timeZone.trim();
  try {
    // Rejects a name no runtime recognises, before it reaches every date in the product.
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    return { ok: false };
  }
  const db = await getDb();
  const [existing] = await db.select({ id: businessCalendar.id }).from(businessCalendar).limit(1);
  if (existing) {
    await db
      .update(businessCalendar)
      .set({ timeZone: zone, updatedAt: new Date() })
      .where(eq(businessCalendar.id, existing.id));
  } else {
    await db.insert(businessCalendar).values({ timeZone: zone, week: FALLBACK_CALENDAR.week });
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function saveQuoteDefaultsAction(input: { validityDays: number; terms: string }): Promise<QuoteDefaults> {
  await requireCapability("settings:manage");
  const clean = cleanQuoteDefaults(input);
  await writeQuoteDefaults(await getDb(), clean);
  revalidatePath("/dashboard/settings/general");
  return clean;
}

export type LogoUploadResult = { ok: true } | { ok: false; reason: "missing" | "tooBig" | "notImage" | "storage" };

/**
 * The logo printed on quotes. PNG or JPEG — what pdf-lib can embed — up to 512 KB, and
 * judged by its first bytes, not by the type the browser claims.
 */
export async function uploadWorkspaceLogoAction(form: FormData): Promise<LogoUploadResult> {
  await requireCapability("settings:manage");
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, reason: "missing" };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, reason: "tooBig" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = logoTypeOf(bytes);
  if (!contentType) return { ok: false, reason: "notImage" };

  const db = await getDb();
  const previous = await readLogoRef(db);
  const key = newStorageKey(contentType === "image/png" ? "logo.png" : "logo.jpg");
  try {
    const storage = await getStorage();
    await storage.put(key, bytes, contentType);
    await writeLogoRef(db, { key, contentType });
    // The old image is only removed once the new one is recorded.
    if (previous) await storage.delete(previous.key).catch(() => undefined);
  } catch (err) {
    console.error("[uploadWorkspaceLogoAction]", err);
    return { ok: false, reason: "storage" };
  }
  revalidatePath("/dashboard/settings/general");
  return { ok: true };
}

export async function removeWorkspaceLogoAction(): Promise<void> {
  await requireCapability("settings:manage");
  const db = await getDb();
  const previous = await readLogoRef(db);
  await writeLogoRef(db, null);
  if (previous) {
    await getStorage()
      .then((s) => s.delete(previous.key))
      .catch(() => undefined);
  }
  revalidatePath("/dashboard/settings/general");
}

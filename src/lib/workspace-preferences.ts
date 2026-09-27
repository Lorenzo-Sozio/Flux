import { eq, inArray, sql } from "drizzle-orm";

import { workspaceSettings } from "@/db/schema";
import { type ApprovalPolicy, approvalPolicyFrom } from "@/lib/quote-status";
import type { getDb } from "@/lib/tenant-context";

/**
 * The workspace's own preferences for its documents: how long a quote stays valid, the
 * conditions printed on every one, and the logo at the top of the PDF.
 *
 * ⚠️ Kept in `workspace_setting`, the workspace's table, and not in `tenants.settings` on
 * the platform: that one is rewritten whole by the platform panel, and it is where the
 * logo used to be settable — by Flux's staff only, and read by nothing.
 */

type Db = Awaited<ReturnType<typeof getDb>>;

export interface QuoteDefaults {
  /** Days from issue to expiry for a new quote; 0 leaves the expiry empty. */
  validityDays: number;
  /** The standard conditions a new quote starts with. */
  terms: string;
}

export const NO_QUOTE_DEFAULTS: QuoteDefaults = { validityDays: 0, terms: "" };
export const MAX_VALIDITY_DAYS = 365;
export const MAX_TERMS_LENGTH = 5_000;

const KEYS = {
  validityDays: "quote.validityDays",
  terms: "quote.terms",
  logo: "brand.logo",
  approval: "quote.approval",
} as const;

/** Whatever was typed, as something a quote can use. */
export function cleanQuoteDefaults(input: { validityDays?: unknown; terms?: unknown }): QuoteDefaults {
  const days = Math.trunc(Number(input.validityDays));
  return {
    validityDays: Number.isFinite(days) ? Math.min(MAX_VALIDITY_DAYS, Math.max(0, days)) : 0,
    terms: typeof input.terms === "string" ? input.terms.trim().slice(0, MAX_TERMS_LENGTH) : "",
  };
}

/** When a quote issued at `issuedAt` expires under these defaults, or null for none. */
export function defaultExpiry(issuedAt: Date, validityDays: number): Date | null {
  return validityDays > 0 ? new Date(issuedAt.getTime() + validityDays * 86_400_000) : null;
}

async function readKeys(db: Db, keys: string[]): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: workspaceSettings.key, value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(inArray(workspaceSettings.key, keys));
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function writeKey(db: Db, key: string, value: unknown) {
  await db
    .insert(workspaceSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: workspaceSettings.key, set: { value, updatedAt: sql`now()` } });
}

/** Never throws: a database without the table yet answers "no defaults", as before. */
export async function readQuoteDefaults(db: Db): Promise<QuoteDefaults> {
  try {
    const found = await readKeys(db, [KEYS.validityDays, KEYS.terms]);
    return cleanQuoteDefaults({ validityDays: found.get(KEYS.validityDays), terms: found.get(KEYS.terms) });
  } catch {
    return { ...NO_QUOTE_DEFAULTS };
  }
}

export async function writeQuoteDefaults(db: Db, defaults: QuoteDefaults): Promise<void> {
  const clean = cleanQuoteDefaults(defaults);
  await writeKey(db, KEYS.validityDays, clean.validityDays);
  await writeKey(db, KEYS.terms, clean.terms);
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

/** What pdf-lib can draw: it embeds PNG and JPEG and nothing else. */
export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];
export const LOGO_MAX_BYTES = 512 * 1024;

export interface LogoRef {
  key: string;
  contentType: LogoType;
}

/**
 * Whether these bytes are the image they claim to be. The type the browser sends is the
 * uploader's word; the first bytes are the file's.
 */
export function logoTypeOf(bytes: Uint8Array): LogoType | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export async function readLogoRef(db: Db): Promise<LogoRef | null> {
  try {
    const value = (await readKeys(db, [KEYS.logo])).get(KEYS.logo) as Partial<LogoRef> | undefined;
    if (!value || typeof value.key !== "string") return null;
    if (!(LOGO_TYPES as readonly string[]).includes(value.contentType ?? "")) return null;
    return { key: value.key, contentType: value.contentType as LogoType };
  } catch {
    return null;
  }
}

/** Sets the logo, or removes it: the column holds no null, so no logo is no row. */
export async function writeLogoRef(db: Db, ref: LogoRef | null): Promise<void> {
  if (ref) await writeKey(db, KEYS.logo, ref);
  else await db.delete(workspaceSettings).where(eq(workspaceSettings.key, KEYS.logo));
}

// ─── Approval ─────────────────────────────────────────────────────────────────

/**
 * Above which discount, or which total, a quote needs a signature before it leaves (§7.5).
 *
 * ⚠️ The threshold was read from the platform's copy of the workspace settings, which no
 * screen of the workspace could write — so every workspace had the default and nobody could
 * change it. It is the workspace's own setting now; a value set the old way still counts
 * until somebody saves one here.
 */
export async function readApprovalPolicy(db: Db, platformSettings?: string | null): Promise<ApprovalPolicy> {
  const fallback = approvalPolicyFrom(platformSettings);
  try {
    const value = (await readKeys(db, [KEYS.approval])).get(KEYS.approval) as Partial<ApprovalPolicy> | undefined;
    return value ? cleanApprovalPolicy({ ...fallback, ...value }) : fallback;
  } catch {
    return fallback;
  }
}

export function cleanApprovalPolicy(input: { maxDiscountPercent?: unknown; maxTotalAmount?: unknown }): ApprovalPolicy {
  const pct = Number(input.maxDiscountPercent);
  const total = Number(input.maxTotalAmount);
  return {
    maxDiscountPercent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
    maxTotalAmount: Number.isFinite(total) ? Math.max(0, total) : 0,
  };
}

export async function writeApprovalPolicy(db: Db, policy: ApprovalPolicy): Promise<void> {
  await writeKey(db, KEYS.approval, cleanApprovalPolicy(policy));
}

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { getAppUrlOrNull } from "@/lib/app-url";
import { signBrandLogoToken } from "@/lib/brand-logo-token";
import {
  type BrandLang,
  brandHeaderHtml,
  type EmailBrand,
  type SignaturePerson,
  type SignatureSettings,
  type SignatureVariant,
  SOCIAL_KINDS,
  signatureHtml,
  signaturePerson,
} from "@/lib/email-brand";
import { sellerIdentity } from "@/lib/seller-identity";
import { getCurrentTenantId } from "@/lib/tenant-context";
import { readBrandIdentity, readLogoRef, readSignatureSettings } from "@/lib/workspace-preferences";

// biome-ignore lint/suspicious/noExplicitAny: a tenant handle, from getDb or createTenantDb
type AnyDb = any;

/**
 * The public address of the workspace's logo, for an email: signed for this workspace
 * (src/lib/brand-logo-token.ts), with the stored object's fingerprint so a new logo is a new
 * address and no mail client's cache keeps the old one. Null without a logo, a workspace or a
 * configured origin — a wordmark then stands in, never a link to nowhere.
 */
export function brandLogoUrl(tenantId: string | null, logoKey: string | null): string | null {
  if (!tenantId || !logoKey) return null;
  try {
    const origin = getAppUrlOrNull();
    if (!origin) return null;
    const version = createHash("sha256").update(logoKey).digest("hex").slice(0, 10);
    return `${origin}/api/brand/logo/${signBrandLogoToken(tenantId)}?v=${version}`;
  } catch {
    // No AUTH_SECRET: no signed address, the wordmark.
    return null;
  }
}

/**
 * Everything the business shows of itself in an email: the issuer profile (name, address, VAT,
 * phone, email), the identity of Settings → General (colour, website, socials) and the logo.
 *
 * ⚠️ Never throws: an email without its frame's details is still the email. `tenantId` is the
 * workspace when the caller knows it (a cron job, a public route); otherwise the request's.
 */
export async function loadEmailBrand(db: AnyDb, tenantId?: string | null): Promise<EmailBrand> {
  const [seller, identity, logo, current] = await Promise.all([
    sellerIdentity(db).catch(() => null),
    readBrandIdentity(db),
    readLogoRef(db),
    // Inside a function, so even a throw before the promise exists is a missing workspace.
    tenantId === undefined ? (async () => getCurrentTenantId())().catch(() => null) : Promise.resolve(tenantId),
  ]);
  return {
    name: seller?.name ?? "",
    color: identity.color,
    logoUrl: brandLogoUrl(current, logo?.key ?? null),
    website: identity.website,
    socials: SOCIAL_KINDS.flatMap((kind) => (identity.socials[kind] ? [{ kind, url: identity.socials[kind] }] : [])),
    address: seller?.address ?? null,
    vatNumber: seller?.vatNumber ?? null,
    phone: seller?.phone ?? null,
    email: seller?.email ?? null,
  };
}

/** A person as their signature shows them: the account's name and address, their Profile's part. */
export async function loadSignaturePerson(
  db: AnyDb,
  userId: string,
): Promise<{ person: SignaturePerson; settings: SignatureSettings } | null> {
  try {
    const [[me], settings] = await Promise.all([
      db.select({ name: users.name, email: users.email, image: users.image }).from(users).where(eq(users.id, userId)),
      readSignatureSettings(db, userId),
    ]);
    if (!me) return null;
    return { person: signaturePerson(me, settings), settings };
  } catch (err) {
    console.error("[email-brand] signature not loaded:", err);
    return null;
  }
}

/**
 * The signature of `userId`, ready to append — or "" when they switched theirs off.
 * One call for the senders that have only a user id: a sequence step, an automation, a campaign.
 */
export async function signatureFor(
  db: AnyDb,
  userId: string | null | undefined,
  brand: EmailBrand,
  variant: SignatureVariant,
  lang: BrandLang,
): Promise<string> {
  if (!userId) return "";
  const found = await loadSignaturePerson(db, userId);
  if (!found || !found.settings.enabled) return "";
  return signatureHtml({ person: found.person, brand, variant, lang });
}

/**
 * `{{intestazione}}` and `{{firma}}` for the senders that render placeholders themselves — a
 * campaign, a sequence, a rule. ⚠️ HTML, by design: they are the workspace's own markup, built
 * from escaped values, never text a recipient wrote.
 */
export function brandValues(brand: EmailBrand, signature: string): { brandHeader: string; signature: string } {
  return { brandHeader: brandHeaderHtml(brand), signature };
}

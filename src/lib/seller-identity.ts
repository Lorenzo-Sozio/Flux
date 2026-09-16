import { eq } from "drizzle-orm";

import { invoiceIssuers } from "@/db/schema";
import { getTenantById } from "@/lib/get-tenant";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getCurrentTenantId } from "@/lib/tenant-context";

/**
 * Who a quote comes from, as the customer reads it.
 *
 * ⚠️ The quote PDF and its print view put `APP_CONFIG.name` at the top — "Flux
 * CRM" — so every customer received an offer from the software rather than from
 * the company making it. The issuer profile written for invoicing is that company;
 * the workspace name stands in until the profile is filled in.
 */
export interface SellerIdentity {
  name: string;
  vatNumber: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

// biome-ignore lint/suspicious/noExplicitAny: a tenant handle, from getDb or createTenantDb
export async function sellerIdentity(db: any, fallbackName?: string | null): Promise<SellerIdentity> {
  const [issuer] = await tolerateUnmigrated(
    "invoice_issuer",
    () => db.select().from(invoiceIssuers).where(eq(invoiceIssuers.id, "workspace")),
    [] as (typeof invoiceIssuers.$inferSelect)[],
  );

  let name = issuer?.legalName?.trim() || fallbackName?.trim() || "";
  if (!name) {
    const tenantId = await getCurrentTenantId().catch(() => null);
    name = (tenantId ? (await getTenantById(tenantId))?.name : null) ?? "";
  }

  const cityLine = [issuer?.zipCode, issuer?.city, issuer?.province ? `(${issuer.province})` : null]
    .filter(Boolean)
    .join(" ");
  const address = [issuer?.street, cityLine].filter(Boolean).join(", ") || null;

  return {
    name,
    vatNumber: issuer?.vatNumber ?? null,
    address,
    email: issuer?.email ?? null,
    phone: issuer?.phone ?? null,
  };
}

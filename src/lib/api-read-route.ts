import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { createTenantDb } from "@/db";
import { companies } from "@/db/schema";
import type { ApiAuthResult } from "@/lib/api-import-auth";
import { listEntity, parseListQuery, type ReadableEntity } from "@/lib/api-read";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import type { Actor, TenantRole } from "@/lib/permissions";
import { priceProduct } from "@/lib/price-list";
import { loadCompanyPriceRules } from "@/lib/price-rules-load";
import {
  groupsOf,
  type RecordScope,
  readVisibilityMode,
  SEE_ALL,
  scopeFor,
  type VisibleKind,
  visibleWhere,
} from "@/lib/record-visibility";
import { decryptDbUrl } from "@/lib/tenant-db";

const KIND: Partial<Record<ReadableEntity, VisibleKind>> = {
  contacts: "contact",
  leads: "lead",
  companies: "company",
  deals: "deal",
  orders: "order",
};

/**
 * ⚠️⚠️ A signed-in person reads through the API what they see on the screens
 * (src/lib/record-visibility.ts) — the list pages are not the only way to page through every
 * customer. A key is a machine and reads everything. Built on the workspace database the route
 * opened, never `getDb()`.
 */
// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
async function readerScope(db: any, who: ApiAuthResult): Promise<RecordScope> {
  if (who.via !== "session" || !who.userId) return SEE_ALL;
  const { getActor } = await import("@/lib/auth-guard");
  const actor: Actor = (await getActor()) ?? {
    userId: who.userId,
    tenantRole: who.role as TenantRole,
    isPlatformStaff: false,
  };
  const [mode, groupIds] = await Promise.all([readVisibilityMode(db), groupsOf(db, actor.userId)]);
  return scopeFor(actor, mode, groupIds);
}

/**
 * The body of every `GET /api/crm/<entity>`, after the gate (src/lib/api-read.ts).
 *
 * The same preamble as the writes — a workspace is required, the call counts against the
 * plan's allowance, the database is the workspace's own and never `getDb()` — and nothing
 * is written: a read is not logged in `api_write_log`, which records what integrations did.
 */
export async function listResponse(req: Request, who: ApiAuthResult, entity: ReadableEntity): Promise<NextResponse> {
  if (!who.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }
  try {
    await checkAndTrackApiCall(who.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) return NextResponse.json({ error: err.message }, { status: 429 });
    throw err;
  }

  const parsed = parseListQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });

  const tenant = await getTenantById(who.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  const kind = KIND[entity];
  const visible = kind ? visibleWhere(kind, await readerScope(db, who)) : undefined;
  const page = await listEntity(db as never, entity, parsed.query, visible);

  // ⚠️ A product priced for a customer: the same list and the same rule the salesperson's form
  // uses (src/lib/price-list.ts), so what the assistant quotes is what the quote will say.
  const companyId = new URL(req.url).searchParams.get("companyId");
  if (entity === "products" && companyId) {
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!company) return NextResponse.json({ error: "No company with that id", field: "companyId" }, { status: 400 });
    const rules = await loadCompanyPriceRules(db, companyId);
    page.data = page.data.map((p) => {
      const priced = priceProduct(String(p.id), p.price as number, rules);
      return { ...p, customerPrice: priced.price, priceSource: priced.source, priceListId: rules?.id ?? null };
    });
  }
  return NextResponse.json(page);
}

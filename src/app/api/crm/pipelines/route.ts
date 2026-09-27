import { type NextRequest, NextResponse } from "next/server";

import { createTenantDb } from "@/db";
import { gateApiRequest } from "@/lib/api-import-auth";
import { listPipelineStages } from "@/lib/api-read";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/** What a key must hold to call this (src/lib/api-scopes.ts): the stages are the deals' own. */
const READ_SCOPE = { entity: "deals", access: "read" } as const;

/**
 * The workspace's pipelines and their stages, each stage with its kind (`open`, `won`,
 * `lost`) — so an integration moves a record to the stage this business uses rather than one
 * it assumed. Nothing is written.
 */
export async function GET(req: NextRequest) {
  const gate = await gateApiRequest(req, READ_SCOPE);
  if (gate.response) return gate.response;
  const who = gate.auth;
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
  const tenant = await getTenantById(who.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  return NextResponse.json({ data: await listPipelineStages(db) });
}

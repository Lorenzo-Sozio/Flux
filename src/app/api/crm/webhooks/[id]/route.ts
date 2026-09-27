import { type NextRequest, NextResponse } from "next/server";

import { and, eq, isNull } from "drizzle-orm";

import { createTenantDb } from "@/db";
import { webhooks } from "@/db/schema";
import { gateApiRequest } from "@/lib/api-import-auth";
import { logApiWrite } from "@/lib/api-write-log";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * The route's own name, written once: the write log records it, and two literals that have
 * to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/webhooks/{id}";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const SCOPE = { entity: "webhooks", access: "write" } as const;

/**
 * Unsubscribe: what Zapier and Make call when somebody switches a trigger off.
 *
 * ⚠️⚠️ Only a subscription made through the API — one with no owner. A webhook an
 * administrator created on screen is theirs to remove, and a key that could switch it off
 * could silence the integration somebody else depends on, with nothing on screen to say so.
 * Unmetered, like opt-out: refusing to stop sending because the plan ran out would keep
 * sending.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateApiRequest(req, SCOPE);
  if (gate.response) return gate.response;
  const authResult = gate.auth;

  if (!authResult.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }
  const { id } = await params;
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  const removed = await db
    .delete(webhooks)
    // A key removes what that key made; a signed-in administrator (the gate asks for
    // webhook:manage) any subscription made through the API.
    .where(
      and(
        eq(webhooks.id, id),
        isNull(webhooks.ownerId),
        ...(authResult.via === "apikey" ? [eq(webhooks.apiKeyId, authResult.key?.id ?? "")] : []),
      ),
    )
    .returning({ id: webhooks.id });
  if (removed.length === 0) {
    return NextResponse.json({ error: "No subscription made through the API has this id" }, { status: 404 });
  }

  await logApiWrite(db, authResult, { entity: "webhook", endpoint: ENDPOINT, recordId: id });
  return NextResponse.json({ deleted: true, id });
}

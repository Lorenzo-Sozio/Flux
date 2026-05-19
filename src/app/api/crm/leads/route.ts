import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildLeadPayload, parseOnDuplicate, validateLeadInput } from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!authResult.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }

  try {
    await checkAndTrackApiCall(authResult.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { errors, data } = validateLeadInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const onDuplicate = parseOnDuplicate(body as Record<string, unknown>);
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  if (data.email) {
    const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, data.email));

    if (existing) {
      if (onDuplicate === "error") {
        return NextResponse.json(
          { error: "Conflict", reason: "duplicate_email", existingId: existing.id },
          { status: 409 },
        );
      }

      if (onDuplicate === "update") {
        const [updated] = await db
          .update(leads)
          .set(buildLeadPayload(data, authResult.userId))
          .where(eq(leads.id, existing.id))
          .returning();
        dispatchWebhook("lead.updated", { lead: updated });
        return NextResponse.json({ status: "updated", id: updated.id, data: updated });
      }

      return NextResponse.json({ status: "skipped", reason: "duplicate_email", existingId: existing.id });
    }
  }

  const [created] = await db.insert(leads).values(buildLeadPayload(data, authResult.userId)).returning();
  dispatchWebhook("lead.created", { lead: created });

  return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
}

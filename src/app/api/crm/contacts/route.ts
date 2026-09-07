import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { contacts } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildContactPayload, parseOnDuplicate, validateContactInput } from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/** Marks the event as written by a machine, so an integrator does not
 *  receive its own import back and react to it. */
const API_ORIGIN = { via: "api" as const, actor: null };

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

  const { errors, data } = validateContactInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const onDuplicate = parseOnDuplicate(body as Record<string, unknown>);

  // Resolve the tenant DB directly (getDb() reads x-tenant-id from internal
  // headers set by middleware, which is only available for session-based calls).
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  // ⚠️ No `platformDb` fallback. There used to be one, behind a check on
  // `authResult.tenantId` that the 400 above has already made true — dead code,
  // but sitting in the one place where reaching it would write a customer's
  // contact into the platform registry instead of their own database.
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  if (data.email) {
    const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, data.email));

    if (existing) {
      if (onDuplicate === "error") {
        return NextResponse.json(
          { error: "Conflict", reason: "duplicate_email", existingId: existing.id },
          { status: 409 },
        );
      }

      if (onDuplicate === "update") {
        const [updated] = await db
          .update(contacts)
          .set(buildContactPayload(data, authResult.userId))
          .where(eq(contacts.id, existing.id))
          .returning();
        dispatchWebhook("contact.updated", { contact: updated }, API_ORIGIN, db);
        return NextResponse.json({ status: "updated", id: updated.id, data: updated });
      }

      return NextResponse.json({ status: "skipped", reason: "duplicate_email", existingId: existing.id });
    }
  }

  const [created] = await db.insert(contacts).values(buildContactPayload(data, authResult.userId)).returning();
  dispatchWebhook("contact.created", { contact: created }, API_ORIGIN, db);

  return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
}

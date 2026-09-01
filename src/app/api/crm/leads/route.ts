import { type NextRequest, NextResponse } from "next/server";

import { eq, sql } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildLeadPayload, digitsForMatching, parseOnDuplicate, validateLeadInput } from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * ⚠️ Ogni evento che esce da questa rotta dice di essere stato causato da una **macchina**.
 *
 * È la riga che ferma l'eco alla fonte: un'integrazione scrive un lead qui, questo CRM
 * emette `lead.created`, e l'integrazione lo riceve. Senza sapere che il cambiamento è
 * suo, reagisce a sé stessa — e non smette.
 */
const ORIGINE_API = { via: "api" as const, actor: null };

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

  // ⚠️ **Also by phone, and that is what makes a retry safe on a phone-only contact.**
  //
  // Matching on `email` alone meant that a lead who arrived by phone — which is most of
  // them, when the caller is a phone system — had nothing to be matched on: every retry of
  // the same request created another row. And the column is free text, so the same number
  // typed two ways was two people.
  //
  // The comparison strips everything that is not a digit on both sides. It is a scan today;
  // the day it needs to be fast, the same expression becomes an index. Correct first.
  const digits = digitsForMatching(data.phone);
  const criterio = data.email
    ? eq(leads.email, data.email)
    : digits
      ? sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]+', '', 'g') = ${digits}`
      : null;

  if (criterio) {
    const [existing] = await db.select({ id: leads.id }).from(leads).where(criterio);

    if (existing) {
      if (onDuplicate === "error") {
        return NextResponse.json(
          { error: "Conflict", reason: data.email ? "duplicate_email" : "duplicate_phone", existingId: existing.id },
          { status: 409 },
        );
      }

      if (onDuplicate === "update") {
        const [updated] = await db
          .update(leads)
          .set(buildLeadPayload(data, authResult.userId))
          .where(eq(leads.id, existing.id))
          .returning();
        dispatchWebhook("lead.updated", { lead: updated }, ORIGINE_API);
        return NextResponse.json({ status: "updated", id: updated.id, data: updated });
      }

      return NextResponse.json({
        status: "skipped",
        reason: data.email ? "duplicate_email" : "duplicate_phone",
        existingId: existing.id,
      });
    }
  }

  const [created] = await db.insert(leads).values(buildLeadPayload(data, authResult.userId)).returning();
  dispatchWebhook("lead.created", { lead: created }, ORIGINE_API);

  return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
}

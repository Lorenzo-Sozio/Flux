import { type NextRequest, NextResponse } from "next/server";

import crypto from "node:crypto";

import { count, isNull } from "drizzle-orm";

import { createTenantDb } from "@/db";
import { webhooks } from "@/db/schema";
import { gateApiRequest } from "@/lib/api-import-auth";
import { logApiWrite } from "@/lib/api-write-log";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";
import { cleanSubscription } from "@/lib/webhook-events";
import { validateWebhookUrl } from "@/lib/webhook-validator";

/**
 * The route's own name, written once: the write log records it, and two literals that have
 * to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/webhooks";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const SCOPE = { entity: "webhooks", access: "write" } as const;

/**
 * Every event fans out to every subscription: a key looping on this would make each
 * contact saved a hundred deliveries. Subscriptions made on screen do not count.
 */
const MAX_API_SUBSCRIPTIONS = 50;

/**
 * Subscribe a URL to events — the REST hook Zapier and Make call when somebody switches a
 * trigger on (§13.11). Body: `{ "url": "https://…", "events": ["contact.created"] }`.
 *
 * The answer carries the signing secret, once: deliveries are signed with it exactly as for
 * a webhook made on screen (`X-Webhook-Signature`). A subscription made here has no owner,
 * and only such a subscription can be removed with a key (`DELETE /api/crm/webhooks/{id}`):
 * a key cannot switch off what an administrator set up.
 */
export async function POST(req: NextRequest) {
  const gate = await gateApiRequest(req, SCOPE);
  if (gate.response) return gate.response;
  const authResult = gate.auth;

  if (!authResult.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }
  try {
    await checkAndTrackApiCall(authResult.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) return NextResponse.json({ error: err.message }, { status: 429 });
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const urlError = url ? validateWebhookUrl(url) : "url is required";
  const events = cleanSubscription(body.events);
  const errors = [
    ...(urlError ? [{ field: "url", message: urlError }] : []),
    ...(events.length === 0 ? [{ field: "events", message: "List at least one event (see /developers)" }] : []),
  ];
  if (errors.length > 0) return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  const [{ n }] = await db.select({ n: count() }).from(webhooks).where(isNull(webhooks.ownerId));
  if (n >= MAX_API_SUBSCRIPTIONS) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [{ field: "url", message: `At most ${MAX_API_SUBSCRIPTIONS} subscriptions made through the API` }],
      },
      { status: 422 },
    );
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "API subscription";
  const secret = crypto.randomBytes(32).toString("hex");
  const [row] = await db
    .insert(webhooks)
    // ⚠️ The key that made it: revoking that key switches it off, and only that key removes it.
    .values({ name, url, events, secret, ownerId: null, isActive: true, apiKeyId: authResult.key?.id ?? null })
    .returning({ id: webhooks.id });

  await logApiWrite(db, authResult, { entity: "webhook", endpoint: ENDPOINT, recordId: row.id });
  return NextResponse.json({ id: row.id, url, events, secret }, { status: 201 });
}

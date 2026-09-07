import { type NextRequest, NextResponse } from "next/server";

import { eq, inArray } from "drizzle-orm";

import { dispatchWebhook, hasActiveWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { chunk, claimTracker, INSERT_CHUNK, LOOKUP_CHUNK } from "@/lib/api-import-batch";
import {
  buildLeadPayload,
  type OnDuplicate,
  parseOnDuplicate,
  type ValidationError,
  validateLeadInput,
} from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/** Marks the event as written by a machine, so an integrator does not
 *  receive its own import back and react to it. */
const API_ORIGIN = { via: "api" as const, actor: null };

const MAX_BATCH = 500;

type BulkResult =
  | { index: number; status: "created"; id: string }
  | { index: number; status: "updated"; id: string }
  | { index: number; status: "skipped"; reason: string; existingId: string }
  | { index: number; status: "error"; errors: ValidationError[] };

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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.records)) {
    return NextResponse.json({ error: "records must be an array" }, { status: 400 });
  }

  const records = raw.records as unknown[];
  if (records.length === 0) {
    return NextResponse.json({ error: "records array must not be empty" }, { status: 400 });
  }
  if (records.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch size exceeds maximum of ${MAX_BATCH}` }, { status: 400 });
  }

  const onDuplicate: OnDuplicate = parseOnDuplicate(raw);
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  // ⚠️ Asked once, not once per row. `dispatchWebhook` reads the webhook
  // table on every call, which for a full batch is five hundred round
  // trips against a subrequest budget of a thousand — spent entirely on
  // learning that a workspace with no webhooks still has no webhooks.
  const notify = await hasActiveWebhook(db);
  const startMs = Date.now();
  // Indexed by position, so the three passes below can fill it in any order and
  // the caller still gets one result per record, in the order they sent them.
  const results: BulkResult[] = new Array(records.length);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  // ── One: validate. No database at all. ──────────────────────────────────────
  const pending: { index: number; data: NonNullable<ReturnType<typeof validateLeadInput>["data"]> }[] = [];
  for (let i = 0; i < records.length; i++) {
    const { errors, data } = validateLeadInput(records[i]);
    if (errors.length > 0 || !data) {
      results[i] = { index: i, status: "error", errors };
      errored++;
      continue;
    }
    pending.push({ index: i, data });
  }

  // ── Two: every email in the batch, in one statement. ────────────────────────
  // See src/lib/api-import-batch.ts for why this used to be one per record and
  // why that was not merely slow.
  const emails = [...new Set(pending.map((p) => p.data.email).filter((e): e is string => Boolean(e)))];
  const found: [string, string][] = [];
  for (const slice of chunk(emails, LOOKUP_CHUNK)) {
    const rows = await db.select({ id: leads.id, email: leads.email }).from(leads).where(inArray(leads.email, slice));
    for (const row of rows) if (row.email) found.push([row.email, row.id]);
  }
  const taken = claimTracker(found);

  // ── Three: decide. Still no database. ───────────────────────────────────────
  const toInsert: { id: string; values: ReturnType<typeof buildLeadPayload> }[] = [];
  const toUpdate: { id: string; values: ReturnType<typeof buildLeadPayload> }[] = [];

  for (const { index, data } of pending) {
    const existingId = taken.find(data.email);

    if (existingId) {
      if (onDuplicate === "error") {
        results[index] = {
          index,
          status: "error",
          errors: [{ field: "email", message: `Duplicate email: ${data.email}` }],
        };
        errored++;
        continue;
      }
      if (onDuplicate === "update") {
        toUpdate.push({ id: existingId, values: buildLeadPayload(data, authResult.userId) });
        results[index] = { index, status: "updated", id: existingId };
        updated++;
        continue;
      }
      results[index] = { index, status: "skipped", reason: "duplicate_email", existingId };
      skipped++;
      continue;
    }

    // Generated here rather than read back from `RETURNING`, so a multi-row
    // insert does not have to be trusted to return rows in the order given —
    // and so the row can be claimed below before it exists.
    const id = crypto.randomUUID();
    toInsert.push({ id, values: buildLeadPayload(data, authResult.userId) });
    taken.claim(data.email, id);
    results[index] = { index, status: "created", id };
    created++;
  }

  // ── Four: write. Inserts first, because an update may target one of them. ───
  for (const slice of chunk(toInsert, INSERT_CHUNK)) {
    await db.insert(leads).values(slice.map((r) => ({ id: r.id, ...r.values })));
  }
  // Each update carries different values, so these stay one statement apiece.
  for (const row of toUpdate) {
    await db.update(leads).set(row.values).where(eq(leads.id, row.id));
  }

  if (notify) {
    for (const row of toInsert) dispatchWebhook("lead.created", { leadId: row.id }, API_ORIGIN, db);
    for (const row of toUpdate) dispatchWebhook("lead.updated", { leadId: row.id }, API_ORIGIN, db);
  }

  return NextResponse.json({
    summary: {
      total: records.length,
      created,
      updated,
      skipped,
      errors: errored,
      durationMs: Date.now() - startMs,
    },
    results,
  });
}

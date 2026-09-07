import { type NextRequest, NextResponse } from "next/server";

import { dispatchWebhook, hasActiveWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { activities } from "@/db/schema";
import { claim, hashBody, release, remember } from "@/lib/api-idempotency";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { chunk, INSERT_CHUNK } from "@/lib/api-import-batch";
import { buildActivityPayload, type ValidationError, validateActivityInput } from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/** Marks the event as written by a machine, so an integrator does not
 *  receive its own import back and react to it. */
const API_ORIGIN = { via: "api" as const, actor: null };

const MAX_BATCH = 500;

type BulkResult =
  | { index: number; status: "created"; id: string }
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

  // ⚠️ Read as text and parsed here rather than through `req.json()`, so the
  // hash below covers exactly the bytes the caller sent. Re-serialising a parsed
  // object would make two identical requests hash differently over nothing more
  // than key order.
  const rawBody = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
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

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // ── The same request twice ──────────────────────────────────────────────────
  //
  // Everything below reports what happened, and all of it depends on the
  // response arriving. When it does not the caller knows nothing, and sending
  // the batch again duplicates whatever this route cannot deduplicate. A key
  // makes that retry safe. No key, and nothing changes.
  const idempotency = await claim(
    db,
    "/api/crm/activities/bulk",
    req.headers.get("Idempotency-Key"),
    await hashBody(rawBody),
  );
  if (idempotency.kind === "replay") {
    return NextResponse.json(idempotency.body, { headers: { "Idempotent-Replay": "true" } });
  }
  if (idempotency.kind === "in-flight") {
    return NextResponse.json(
      { error: "A request with this Idempotency-Key is still running. Retry in a moment." },
      { status: 409 },
    );
  }
  if (idempotency.kind === "mismatch") {
    return NextResponse.json(
      { error: "This Idempotency-Key was already used with a different request body." },
      { status: 422 },
    );
  }
  // ⚠️ Asked once, not once per row. `dispatchWebhook` reads the webhook
  // table on every call, which for a full batch is five hundred round
  // trips against a subrequest budget of a thousand — spent entirely on
  // learning that a workspace with no webhooks still has no webhooks.
  const notify = await hasActiveWebhook(db);
  // ⚠️ The key is released if anything below throws. Without that a handler
  // that dies leaves it held for the whole stale window, and the caller's
  // obvious next move — retry with the same key — is refused for fifteen
  // minutes over an import that never happened.
  try {
    const startMs = Date.now();
    // Indexed by position, so a rejected record keeps the place its sender gave it.
    const results: BulkResult[] = new Array(records.length);
    const toInsert: { id: string; values: ReturnType<typeof buildActivityPayload> }[] = [];
    let created = 0;
    let errored = 0;

    for (let i = 0; i < records.length; i++) {
      const { errors, data } = validateActivityInput(records[i]);

      if (errors.length > 0 || !data) {
        results[i] = { index: i, status: "error", errors };
        errored++;
        continue;
      }

      // ⚠️ The id is generated here rather than read back from `RETURNING`, so
      // a multi-row insert does not have to be trusted to return its rows in
      // the order they were given.
      const id = crypto.randomUUID();
      toInsert.push({ id, values: buildActivityPayload(data, authResult.userId) });
      results[i] = { index: i, status: "created", id };
      created++;
    }

    // ⚠️ One statement per chunk, not one per record. Every statement on the
    // Neon HTTP driver is its own request, and a full batch of five hundred was
    // five hundred of them inside a request with a budget of a thousand.
    for (const slice of chunk(toInsert, INSERT_CHUNK)) {
      await db.insert(activities).values(slice.map((r) => ({ id: r.id, ...r.values })));
    }

    if (notify) {
      for (const row of toInsert) dispatchWebhook("activity.created", { activityId: row.id }, API_ORIGIN, db);
    }

    const payload = {
      summary: {
        total: records.length,
        created,
        updated: 0,
        skipped: 0,
        errors: errored,
        durationMs: Date.now() - startMs,
      },
      results,
    };

    // Stored before answering, so a retry that arrives while this response is
    // still in flight replays it rather than importing again.
    await remember(db, idempotency, payload);

    return NextResponse.json(payload);
  } catch (error) {
    await release(db, idempotency);
    throw error;
  }
}

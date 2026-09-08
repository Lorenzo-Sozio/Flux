import { type NextRequest, NextResponse } from "next/server";

import { eq, inArray } from "drizzle-orm";

import { dispatchWebhook, hasActiveWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { contacts } from "@/db/schema";
import { claim, hashBody, release, remember } from "@/lib/api-idempotency";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { chunk, claimTracker, INSERT_CHUNK, LOOKUP_CHUNK } from "@/lib/api-import-batch";
import {
  buildContactPayload,
  type OnDuplicate,
  parseOnDuplicate,
  type ValidationError,
  validateContactInput,
} from "@/lib/api-import-validators";
import { logApiWrite } from "@/lib/api-write-log";
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

/**
 * The route's own name, written once: the idempotency ledger and the write log both
 * record it, and two literals that have to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/contacts/bulk";

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

  const onDuplicate: OnDuplicate = parseOnDuplicate(raw);
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // ── The same request twice ──────────────────────────────────────────────────
  //
  // Everything below reports what happened, and all of it depends on the
  // response arriving. When it does not the caller knows nothing, and sending
  // the batch again duplicates whatever this route cannot deduplicate. A key
  // makes that retry safe. No key, and nothing changes.
  const idempotency = await claim(db, ENDPOINT, req.headers.get("Idempotency-Key"), await hashBody(rawBody));
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
    // Indexed by position, so the three passes below can fill it in any order and
    // the caller still gets one result per record, in the order they sent them.
    const results: BulkResult[] = new Array(records.length);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errored = 0;

    // ── One: validate. No database at all. ──────────────────────────────────────
    const pending: { index: number; data: NonNullable<ReturnType<typeof validateContactInput>["data"]> }[] = [];
    for (let i = 0; i < records.length; i++) {
      const { errors, data } = validateContactInput(records[i]);
      if (errors.length > 0 || !data) {
        results[i] = { index: i, status: "error", errors };
        errored++;
        continue;
      }
      pending.push({ index: i, data });
    }

    // ── Two: every email in the batch, in one statement. ────────────────────────
    //
    // ⚠️ This is the statement that used to be five hundred of them, one before
    // each write, sequentially. See src/lib/api-import-batch.ts for why that was
    // not merely slow.
    const emails = [...new Set(pending.map((p) => p.data.email).filter((e): e is string => Boolean(e)))];
    const found: [string, string][] = [];
    for (const slice of chunk(emails, LOOKUP_CHUNK)) {
      const rows = await db
        .select({ id: contacts.id, email: contacts.email })
        .from(contacts)
        .where(inArray(contacts.email, slice));
      for (const row of rows) if (row.email) found.push([row.email, row.id]);
    }
    const taken = claimTracker(found);

    // ── Three: decide. Still no database. ───────────────────────────────────────
    const toInsert: { id: string; values: ReturnType<typeof buildContactPayload> }[] = [];
    const toUpdate: { index: number; id: string; values: ReturnType<typeof buildContactPayload> }[] = [];

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
          toUpdate.push({ index, id: existingId, values: buildContactPayload(data, authResult.userId) });
          results[index] = { index, status: "updated", id: existingId };
          updated++;
          continue;
        }
        results[index] = { index, status: "skipped", reason: "duplicate_email", existingId };
        skipped++;
        continue;
      }

      // ⚠️ The id is generated here rather than read back from `RETURNING`, so a
      // multi-row insert does not have to be trusted to return its rows in the
      // order they were given. It also lets the row be claimed below before it
      // exists.
      const id = crypto.randomUUID();
      toInsert.push({ id, values: buildContactPayload(data, authResult.userId) });
      taken.claim(data.email, id);
      results[index] = { index, status: "created", id };
      created++;
    }

    // ── Four: write. Inserts first, because an update may target one of them. ───
    for (const slice of chunk(toInsert, INSERT_CHUNK)) {
      await db.insert(contacts).values(slice.map((r) => ({ id: r.id, ...r.values })));
    }
    // Each update carries different values, so these stay one statement apiece.
    // `onDuplicate: "update"` is a deliberate choice by the caller, and it is the
    // only mode that still costs a round trip per record.
    for (const row of toUpdate) {
      await db.update(contacts).set(row.values).where(eq(contacts.id, row.id));
    }

    if (notify) {
      for (const row of toInsert) dispatchWebhook("contact.created", { contactId: row.id }, API_ORIGIN, db);
      for (const row of toUpdate) dispatchWebhook("contact.updated", { contactId: row.id }, API_ORIGIN, db);
    }

    const payload = {
      summary: {
        total: records.length,
        created,
        updated,
        skipped,
        errors: errored,
        durationMs: Date.now() - startMs,
      },
      results,
    };

    // ⚠️ One line for the request, not one per record: a batch of five hundred is a single
    // thing that happened, and `rows` says how big it was. Rows that were skipped or
    // rejected are not counted — nothing was written for them, and counting them would
    // make the report flatter whoever sent the batch.
    await logApiWrite(db, authResult, {
      entity: "contact",
      endpoint: ENDPOINT,
      rows: payload.summary.created + payload.summary.updated,
    });

    // Stored before answering, so a retry that arrives while this response is
    // still in flight replays it rather than importing again.
    await remember(db, idempotency, payload);

    return NextResponse.json(payload);
  } catch (error) {
    await release(db, idempotency);
    throw error;
  }
}

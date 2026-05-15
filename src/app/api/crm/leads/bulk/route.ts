import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import {
  buildLeadPayload,
  type OnDuplicate,
  parseOnDuplicate,
  type ValidationError,
  validateLeadInput,
} from "@/lib/api-import-validators";
import { getDb } from "@/lib/tenant-context";

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
  const db = await getDb();
  const startMs = Date.now();
  const results: BulkResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (let i = 0; i < records.length; i++) {
    const { errors, data } = validateLeadInput(records[i]);

    if (errors.length > 0 || !data) {
      results.push({ index: i, status: "error", errors });
      errored++;
      continue;
    }

    if (data.email) {
      const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.email, data.email));

      if (existing) {
        if (onDuplicate === "error") {
          results.push({
            index: i,
            status: "error",
            errors: [{ field: "email", message: `Duplicate email: ${data.email}` }],
          });
          errored++;
          continue;
        }

        if (onDuplicate === "update") {
          const [row] = await db
            .update(leads)
            .set(buildLeadPayload(data, authResult.userId))
            .where(eq(leads.id, existing.id))
            .returning({ id: leads.id });
          dispatchWebhook("lead.updated", { leadId: row.id });
          results.push({ index: i, status: "updated", id: row.id });
          updated++;
          continue;
        }

        results.push({ index: i, status: "skipped", reason: "duplicate_email", existingId: existing.id });
        skipped++;
        continue;
      }
    }

    const [row] = await db.insert(leads).values(buildLeadPayload(data, authResult.userId)).returning({ id: leads.id });
    dispatchWebhook("lead.created", { leadId: row.id });
    results.push({ index: i, status: "created", id: row.id });
    created++;
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

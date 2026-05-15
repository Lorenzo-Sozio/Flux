import { type NextRequest, NextResponse } from "next/server";

import { dispatchWebhook } from "@/actions/webhooks";
import { activities } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildActivityPayload, type ValidationError, validateActivityInput } from "@/lib/api-import-validators";
import { getDb } from "@/lib/tenant-context";

const MAX_BATCH = 500;

type BulkResult =
  | { index: number; status: "created"; id: string }
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

  const db = await getDb();
  const startMs = Date.now();
  const results: BulkResult[] = [];
  let created = 0;
  let errored = 0;

  for (let i = 0; i < records.length; i++) {
    const { errors, data } = validateActivityInput(records[i]);

    if (errors.length > 0 || !data) {
      results.push({ index: i, status: "error", errors });
      errored++;
      continue;
    }

    const [row] = await db
      .insert(activities)
      .values(buildActivityPayload(data, authResult.userId))
      .returning({ id: activities.id });
    dispatchWebhook("activity.created", { activityId: row.id });
    results.push({ index: i, status: "created", id: row.id });
    created++;
  }

  return NextResponse.json({
    summary: {
      total: records.length,
      created,
      updated: 0,
      skipped: 0,
      errors: errored,
      durationMs: Date.now() - startMs,
    },
    results,
  });
}

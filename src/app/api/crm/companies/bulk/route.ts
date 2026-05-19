import { type NextRequest, NextResponse } from "next/server";

import { ilike } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { companies } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import {
  buildCompanyPayload,
  type OnDuplicate,
  parseOnDuplicate,
  type ValidationError,
  validateCompanyInput,
} from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

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
  const startMs = Date.now();
  const results: BulkResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (let i = 0; i < records.length; i++) {
    const { errors, data } = validateCompanyInput(records[i]);

    if (errors.length > 0 || !data) {
      results.push({ index: i, status: "error", errors });
      errored++;
      continue;
    }

    const [existing] = await db.select({ id: companies.id }).from(companies).where(ilike(companies.name, data.name));

    if (existing) {
      if (onDuplicate === "error") {
        results.push({
          index: i,
          status: "error",
          errors: [{ field: "name", message: `Duplicate name: ${data.name}` }],
        });
        errored++;
        continue;
      }

      if (onDuplicate === "update") {
        const [row] = await db
          .update(companies)
          .set(buildCompanyPayload(data, authResult.userId))
          .where(ilike(companies.name, data.name))
          .returning({ id: companies.id });
        dispatchWebhook("company.updated", { companyId: row.id });
        results.push({ index: i, status: "updated", id: row.id });
        updated++;
        continue;
      }

      results.push({ index: i, status: "skipped", reason: "duplicate_name", existingId: existing.id });
      skipped++;
      continue;
    }

    const [row] = await db
      .insert(companies)
      .values(buildCompanyPayload(data, authResult.userId))
      .returning({ id: companies.id });
    dispatchWebhook("company.created", { companyId: row.id });
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

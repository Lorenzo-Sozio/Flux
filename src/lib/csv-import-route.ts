import { NextResponse } from "next/server";

import Papa from "papaparse";

import {
  EntitlementError,
  ForbiddenError,
  requireCapability,
  requirePlanLimit,
  UnauthenticatedError,
} from "@/lib/auth-guard";
import { type CsvEntity, MAX_IMPORT_ROWS, type OnDuplicate, planCsvImport } from "@/lib/csv-import";
import { applyMapping } from "@/lib/csv-import-fields";
import { serverT } from "@/lib/i18n-server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { countRecords } from "@/lib/record-count";
import { getDb } from "@/lib/tenant-context";

/**
 * The dashboard's CSV import, one handler for contacts, leads and companies.
 *
 * ⚠️⚠️ **`record:import`, checked.** The capability existed and nothing asked for it: the
 * contact and company routes only checked that *somebody* was signed in, so a viewer —
 * read-only everywhere else — could import five thousand rows. The plan's record limit
 * was skipped the same way. Leads had a button and no route at all.
 *
 * The rate limit is the platform table's, for all three. The company route kept its count
 * in a module-level Map, which on Workers resets with every isolate and so limited nothing.
 */
export async function handleCsvImport(req: Request, entity: CsvEntity): Promise<Response> {
  let actor: Awaited<ReturnType<typeof requireCapability>>;
  try {
    actor = await requireCapability("record:import");
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return NextResponse.json({ error: (await serverT())("generic.unauthenticated") }, { status: 401 });
    }
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const ti = await serverT("serverErrors.imports");

  const form = await req.formData();
  // The wizard's preview: the same plan, never written. Several are expected while a
  // mapping is adjusted, so they have their own, looser allowance.
  const dryRun = form.get("dryRun") === "1";
  const bucket = dryRun ? `import_preview_${entity}:${actor.userId}` : `import_${entity}:${actor.userId}`;
  if (!(await checkRateLimit(bucket, dryRun ? 30 : 3, 10 * 60_000))) {
    return NextResponse.json({ error: ti("tooMany") }, { status: 429 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: ti("noFile") }, { status: 400 });
  const onDuplicate = parseOnDuplicate(form.get("onDuplicate"));
  const mapping = parseMapping(form.get("mapping"));

  // No delimiter given: Papa detects it, so the `;` Italian Excel writes works as well as `,`.
  const { data, errors } = Papa.parse<Record<string, string>>(await file.text(), {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: ti("csvParse"), details: errors.slice(0, 20) }, { status: 400 });
  }
  if (data.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: ti("tooManyRows", { max: MAX_IMPORT_ROWS }) }, { status: 400 });
  }

  const db = await getDb();
  // The columns the person mapped in the wizard; without a mapping, headers are guessed.
  const rows = mapping ? data.map((row) => applyMapping(row, mapping)) : data;
  const plan = await planCsvImport(db, entity, rows, actor.userId, { onDuplicate });

  // ⚠️ The whole file or nothing. `requirePlanLimit` refuses when the value it is given has
  // reached the limit, so it is asked about the last record this file would add.
  let limitError: string | null = null;
  if (plan.newRecords > 0) {
    try {
      await requirePlanLimit("maxRecords", (await countRecords(db)) + plan.newRecords - 1);
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      // The preview says so; the import itself refuses.
      if (!dryRun) return NextResponse.json({ error: err.message }, { status: 403 });
      limitError = err.message;
    }
  }

  if (!dryRun) await plan.write();

  return NextResponse.json({
    success: true,
    dryRun,
    created: plan.newRecords,
    updated: plan.updated,
    skipped: plan.skipped,
    duplicates: plan.duplicates,
    errors: plan.errors.slice(0, 50),
    errorCount: plan.errors.length,
    total: plan.total,
    ...(limitError ? { limitError } : {}),
  });
}

function parseOnDuplicate(value: FormDataEntryValue | null): OnDuplicate {
  return value === "update" || value === "create" ? value : "skip";
}

/** `{ header: field }` from the wizard, or null when absent or not that shape. */
function parseMapping(value: FormDataEntryValue | null): Record<string, string> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return null;
  }
}

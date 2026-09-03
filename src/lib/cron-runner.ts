/**
 * cron-runner.ts — the shape every scheduled job shares.
 *
 * Each cron route used to open a single database with `getDb()`, which resolves
 * the workspace from a request header that scheduled requests never carry. All
 * seven jobs therefore threw before doing any work, and a job that does not run
 * leaves no trace: no queued campaign email was ever sent, no SLA was ever
 * evaluated, no failed webhook was ever retried, no reminder ever fired and no
 * resolved ticket ever closed (audit rilievo B-02).
 *
 * A job is now a function of one workspace, run once per workspace, with the
 * result reported per workspace so a single broken tenant is visible instead of
 * fatal.
 */
import { NextResponse } from "next/server";

import { verifyCronRequest } from "@/lib/cron-auth";
import { runWithTenant } from "@/lib/tenant-context";
import { forEachTenant, type Tenant, type TenantDb } from "@/lib/tenant-resolve";

export interface CronJobSummary<T> {
  job: string;
  tenants: number;
  succeeded: number;
  failed: number;
  /** Per-workspace results, so a partial failure can be read from the response. */
  results: { tenant: string | null; result?: T; error?: string }[];
}

/**
 * Authenticates the request, then runs `job` once for every workspace.
 *
 * `job` is called inside `runWithTenant`, so anything it calls — including the
 * server actions written for the dashboard — resolves `getDb()` to the workspace
 * being processed. That is what lets the jobs reuse existing logic rather than
 * carry a second copy of it.
 */
export async function runCronJob<T>(
  name: string,
  req: Request,
  job: (db: TenantDb, tenant: Tenant) => Promise<T>,
): Promise<Response> {
  const authError = verifyCronRequest(req);
  if (authError) return authError;

  const started = Date.now();

  const runs = await forEachTenant(async (db, tenant) => runWithTenant(tenant.id, () => job(db, tenant)));

  const summary: CronJobSummary<T> = {
    job: name,
    tenants: runs.length,
    succeeded: runs.filter((r) => !r.error).length,
    failed: runs.filter((r) => r.error).length,
    results: runs.map((r) => ({ tenant: r.subdomain, result: r.result, error: r.error })),
  };

  console.log(
    `[cron:${name}] ${summary.succeeded}/${summary.tenants} workspaces in ${Date.now() - started}ms` +
      (summary.failed ? ` — ${summary.failed} failed` : ""),
  );

  // A partial failure is still a 200: the scheduler should not retry the whole
  // sweep because one workspace is unreachable. The body carries the detail.
  return NextResponse.json(summary);
}

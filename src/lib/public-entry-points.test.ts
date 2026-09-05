/**
 * Every entry point the proxy does not give a tenant to, checked for `getDb()`.
 *
 * `getDb()` reads the `x-tenant-id` header the proxy injects only for
 * authenticated dashboard requests, and throws when it is absent. A webhook, a
 * cron route or a public page that reaches it fails on every single call — and
 * answers 500, so the sender retries for ever or drops the message. Nothing logs
 * the absence, because from the inside nothing happened.
 *
 * This is audit rilievo B-01, and it has now been found in **twelve** entry
 * points across four separate passes: all seven cron jobs, the public quote
 * page, click and open tracking, unsubscribe, RSVP, the Resend callback, both
 * inbound-email routes, and — most recently — the exchange-rate endpoint the
 * dashboard fetches on every page load, plus the geo endpoints, both of which
 * had been *deliberately* excluded from tenant injection on the belief that
 * their tables were shared. They are not.
 *
 * Finding it a fifth time by hand is not a plan, so this is the check.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

/** Comments name `getDb()` more often than code calls it. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The prefixes read from the proxy itself, not copied.
 *
 * A copy would drift the moment somebody excluded a new path, and drifting is
 * the whole failure this file exists to catch.
 */
function publicPrefixes(): string[] {
  const src = read("src/proxy.ts");
  const block = src.match(/const PUBLIC_PREFIXES = \[([\s\S]*?)\];/);
  if (!block) throw new Error("PUBLIC_PREFIXES not found in src/proxy.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => `src/app${m[1]}`);
}

function allFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) allFiles(f, out);
    else if (/\.tsx?$/.test(e.name)) out.push(f.replace(/\\/g, "/"));
  }
  return out;
}

function resolveImport(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = `src/${spec.slice(2)}`;
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existsSync(c)) return c;
  return null;
}

/** Whether a module calls `getDb()`. Its own definition does not count. */
function callsGetDb(file: string, src: string): boolean {
  if (file.endsWith("src/lib/tenant-context.ts")) return false;
  return /getDb\s*\(\s*\)/.test(stripComments(src));
}

function reachesGetDb(entry: string): boolean {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    if (callsGetDb(file, src)) return true;
    for (const m of src.matchAll(/from\s+"(@\/[^"]+)"/g)) {
      const next = resolveImport(m[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return false;
}

/**
 * Entry points that reach `getDb()` and are nevertheless correct, each with the
 * mechanism that makes it so.
 *
 * ⚠️ A new entry here is a decision, not a formality. Adding one means claiming
 * that the workspace is established before `getDb()` runs — by `runWithTenant`,
 * by passing a handle down explicitly, or by the proxy injecting the header
 * after all. If that claim is wrong the route answers 500 for ever and nothing
 * says so, which is how every previous one of these survived.
 */
const ACCOUNTED_FOR: Record<string, string> = {
  "src/app/api/cron/campaign-scheduler/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/cron/email-worker/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/cron/task-overdue-check/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/cron/task-reminders/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/cron/ticket-autoclose/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/cron/ticket-sla-check/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/cron/webhook-retry/route.ts": "runCronJob wraps the body in runWithTenant",
  "src/app/api/quotes/public/route.ts": "resolves the workspace from the token and passes the handle down",
  "src/app/api/track/click/route.ts": "resolveTenantByProbe on the log id, handle passed down",
  "src/app/api/track/open/route.ts": "resolveTenantByProbe on the log id, handle passed down",
  "src/app/api/unsubscribe/route.ts": "resolveTenantByProbe on the log id, handle passed down",
  "src/app/api/webhooks/resend/route.ts": "resolveTenantByProbe on the message id, handle passed down",
  "src/app/api/webhooks/email-inbound/route.ts":
    "workspace from the subject or the recipient, then runWithTenant for the rules",
  "src/app/api/webhooks/resend-inbound/route.ts":
    "workspace from the subject or the recipient, then runWithTenant for the rules",
  "src/app/api/appointments/rsvp/route.ts": "resolveTenantByProbe on the response token",
};

describe("entry points without a tenant header", () => {
  it("⚠️ reach getDb() only where something establishes the workspace first", () => {
    const prefixes = publicPrefixes();
    const entries = allFiles("src/app").filter(
      (f) => (f.endsWith("/route.ts") || f.endsWith("/page.tsx")) && prefixes.some((p) => f.startsWith(p)),
    );

    // The list must actually be finding things, or a rename turns this green by
    // matching nothing at all.
    expect(entries.length).toBeGreaterThan(5);

    const unaccounted = entries.filter((e) => reachesGetDb(e) && !(e in ACCOUNTED_FOR));
    expect(unaccounted).toEqual([]);
  });

  it("keeps no reason for an entry point that no longer exists", () => {
    // A stale exemption is a hole waiting for a file with the same name.
    const stale = Object.keys(ACCOUNTED_FOR).filter((f) => !existsSync(f));
    expect(stale).toEqual([]);
  });
});

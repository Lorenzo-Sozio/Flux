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

/**
 * The API-key surface has the same problem and was not in the list above.
 *
 * ⚠️ `PUBLIC_PREFIXES` is the proxy's list of routes it deliberately leaves
 * alone. `/api/crm/*` is not on it — but the proxy only injects `x-tenant-id`
 * when `isLoggedIn && activeTenantId`, and a request carrying an API key has no
 * session at all. Its own comment says so: *"API-key authenticated requests have
 * no JWT session, so no tenant header is set here."* So those routes are exactly
 * as tenant-less as the public ones, and the guard above never looked at them.
 *
 * What that cost: every one of the twenty `dispatchWebhook` calls in the import
 * API omitted the database, so each fell through to `getDb()` and rejected. None
 * of them is awaited, so the rejection was swallowed. An integrator importing
 * five hundred contacts got five hundred rows and not one webhook, and nothing
 * anywhere said why.
 *
 * An import-graph check cannot express this: `dispatchWebhook` still *contains*
 * `getDb()` as its fallback, and always will. What matters is the call, so the
 * call is what is checked.
 */
describe("the import API", () => {
  const routes = allFiles("src/app/api/crm").filter((f) => f.endsWith("/route.ts"));

  it("is a set somebody has thought about", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("⚠️ hands dispatchWebhook the workspace, every time", () => {
    // Without it the call resolves `getDb()`, which throws here, and the webhook
    // is silently never sent.
    const bad: string[] = [];
    for (const file of routes) {
      for (const call of read(file).matchAll(/dispatchWebhook\([\s\S]*?\);/g)) {
        if (!/,\s*db\s*\)/.test(call[0])) bad.push(`${file}: ${call[0].slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("⚠️ marks those events as written by a machine", () => {
    // `via: "api"` is what stops an integrator receiving its own import back and
    // reacting to it, for ever. Eighteen of the twenty call sites left it unset,
    // so the events went out looking like a person had made them.
    const bad: string[] = [];
    for (const file of routes) {
      for (const call of read(file).matchAll(/dispatchWebhook\([\s\S]*?\);/g)) {
        if (!call[0].includes("API_ORIGIN")) bad.push(`${file}: ${call[0].slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * The body of every `for` loop in a file, found by counting braces.
   *
   * ⚠️ Written out rather than approximated. The first version of this check
   * looked for the record loop and took everything up to the next line closing a
   * block at indent two — which, once the route grew a separate validation pass,
   * stopped at the end of *that* loop and examined a region containing no writes
   * at all. It passed while a write sat in the loop it was meant to be watching.
   */
  function loopBodies(src: string): { header: string; body: string }[] {
    const out: { header: string; body: string }[] = [];
    for (const m of src.matchAll(/\bfor\s*\(/g)) {
      // ⚠️ Find the brace that opens the *body*, which means walking past the
      // header's own closing parenthesis first. Taking the next `{` instead
      // lands on the destructuring in `for (const { index, data } of pending)`,
      // and the body examined is then the two words between those braces. That
      // is not a hypothetical: it is what the first version of this did, and it
      // reported a loop containing a write as clean.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")" && --depth === 0) break;
      }
      const header = src.slice(m.index, i + 1);
      const open = src.indexOf("{", i);
      if (open < 0) continue;
      depth = 0;
      let j = open;
      for (; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) break;
      }
      out.push({ header, body: src.slice(open, j) });
    }
    return out;
  }

  it("⚠️ writes outside the record loop, not once per row", () => {
    // Every statement on the Neon HTTP driver is its own request, and a bulk
    // route is capped at five hundred records inside a request with a subrequest
    // budget of a thousand. A write in the loop makes the documented maximum the
    // size that cannot complete — which is not only slow: a timed-out import
    // cannot be retried safely, because contacts and leads deduplicate on email
    // alone, email is optional for both, and the activity routes deduplicate on
    // nothing. The speed is what makes the unsafe retry necessary.
    //
    // Two loops may hold a statement, and both are bounded by something other
    // than the record count: the chunked write, and the per-row update that
    // `onDuplicate: "update"` opts into because each row carries different
    // values.
    const allowed = /chunk\(|of toUpdate\b/;
    const offenders: string[] = [];
    for (const file of routes.filter((f) => f.endsWith("/bulk/route.ts"))) {
      for (const { header, body } of loopBodies(read(file))) {
        if (allowed.test(header)) continue;
        if (/await db\./.test(body)) offenders.push(`${file}: for ${header.slice(4, 60).trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("⚠️ keeps the caller's own ordering on every bulk result", () => {
    // The index is how somebody maps a rejected row back to the line in their
    // own file. Filling the array by position rather than pushing is what
    // survives three passes that do not run in record order.
    const pushing = routes.filter((f) => f.endsWith("/bulk/route.ts")).filter((f) => /results\.push\(/.test(read(f)));
    expect(pushing).toEqual([]);
  });

  it("⚠️ never falls back to the platform database", () => {
    // One route did, behind a condition an earlier 400 had already made true.
    // Dead, but sitting where reaching it would write a customer's contact into
    // the platform registry instead of their own database.
    const offenders = routes.filter((f) => /:\s*platformDb\b|\?\?\s*platformDb\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

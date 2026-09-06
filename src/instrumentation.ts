/**
 * Next.js Instrumentation Hook
 *
 * Runs once on server startup (Node.js runtime only).
 * Initialises long-lived services that must exist for the lifetime of
 * the process — currently the automation scheduler.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

/**
 * On Cloudflare Workers no process outlives the request:
 * `NEXT_RUNTIME` vale comunque "nodejs" sotto OpenNext, ma i timer di node-cron
 * they would be reset with every isolate — and registering them at cold start means a
 * query al database prima di poter servire la prima richiesta.
 *
 * On Workers the scheduled runs arrive instead from the Cron Triggers declared in
 * wrangler.jsonc, gestiti da custom-worker.ts.
 */
function isCloudflareWorkers(): boolean {
  return globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

export async function register() {
  // Only run in the Node.js runtime, not in Edge or during the build.
  if (process.env.NEXT_RUNTIME === "nodejs" && !isCloudflareWorkers()) {
    // Report every missing environment variable at once, before the first
    // request. Discovering them one failure at a time costs a deploy each, and
    // several of them fail in ways that name a symptom rather than a cause.
    const { reportEnv } = await import("@/lib/env-check");
    reportEnv();

    const { initializeScheduler } = await import("@/components/crm/automation/scheduler");
    await initializeScheduler();
  }
}

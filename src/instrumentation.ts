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
 * Su Cloudflare Workers non esiste un processo che sopravviva alla richiesta:
 * `NEXT_RUNTIME` vale comunque "nodejs" sotto OpenNext, ma i timer di node-cron
 * verrebbero azzerati a ogni isolate — e registrarli al cold start significa una
 * query al database prima di poter servire la prima richiesta.
 *
 * Su Workers gli scheduled trigger arrivano invece dai Cron Trigger dichiarati in
 * wrangler.jsonc, gestiti da custom-worker.ts.
 */
function isCloudflareWorkers(): boolean {
  return globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

export async function register() {
  // Only run in the Node.js runtime, not in Edge or during the build.
  if (process.env.NEXT_RUNTIME === "nodejs" && !isCloudflareWorkers()) {
    const { initializeScheduler } = await import("@/components/crm/automation/scheduler");
    await initializeScheduler();
  }
}

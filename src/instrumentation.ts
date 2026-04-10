/**
 * Next.js Instrumentation Hook
 *
 * Runs once on server startup (Node.js runtime only).
 * Initialises long-lived services that must exist for the lifetime of
 * the process — currently the automation scheduler.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run in the Node.js runtime, not in Edge or during the build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeScheduler } = await import(
      "@/components/crm/automation/scheduler"
    )
    await initializeScheduler()
  }
}

import { after } from "next/server";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import type { RuleContext } from "@/components/crm/automation/types";
import { runWithTenant } from "@/lib/tenant-context";

/**
 * The workspace's rules, for a write that arrived through the import API.
 *
 * ⚠️⚠️ **Inside `runWithTenant`, always.** A request carrying an API key has no
 * `x-tenant-id` — the proxy injects it only for a signed-in session — and the engine
 * reads its rules through `getDb()`, which throws without one. Four routes called
 * `runAutomations` bare inside `after()`: the rejection was never awaited, so it
 * vanished, and a workspace whose rule said «tell me when a deal is lost» heard
 * nothing about the deals an integration closed. The same failure CLAUDE.md records
 * for `dispatchWebhook`, in the one call site that list did not cover.
 *
 * After the response, like every rule the dashboard runs: whatever the owner's rules
 * do — an email, a task, a webhook — is not something the caller should wait on.
 * A failure is logged, not swallowed; it cannot be returned, because the answer has
 * already gone.
 *
 * ⚠️ One record per call, and only from the single-record routes. The bulk routes
 * are imports, not events: firing «send the welcome email» or «enrol in the
 * sequence» for five hundred historical contacts is the opposite of what somebody
 * migrating their data wants, and the dashboard's CSV import has never run rules
 * either. `public-entry-points.test.ts` holds both halves of that line.
 */
export function runRulesAfterApiWrite(tenantId: string, context: RuleContext): void {
  after(() =>
    runWithTenant(tenantId, () => runAutomations(context)).catch((err) => {
      console.error(`[api] rules for ${context.entityType} ${context.entityId} did not run:`, err);
    }),
  );
}

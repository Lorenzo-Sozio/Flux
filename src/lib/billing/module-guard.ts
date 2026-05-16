import { redirect } from "next/navigation";

import { getTenantById } from "@/lib/get-tenant";
import { getCurrentTenantId } from "@/lib/tenant-context";

import { getEntitlements } from "./licensing";
import type { PlanModule } from "./plans-config";

/**
 * Call at the top of a Server Component or layout to block access when the
 * tenant's plan does not include the required module.
 * Redirects to the billing page with an `upgrade` query param so the UI can
 * surface the right message.
 * No-ops when called outside a tenant context.
 */
export async function requireModuleAccess(module: PlanModule): Promise<void> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;

  const tenant = await getTenantById(tenantId);
  if (!tenant) return;

  const ent = await getEntitlements(tenant.id);

  if (ent.isSuspended || !ent.isActive) {
    redirect("/dashboard/settings/billing");
  }

  if (!ent.enabledModules.includes(module)) {
    redirect(`/dashboard/settings/billing?upgrade=${module}`);
  }
}

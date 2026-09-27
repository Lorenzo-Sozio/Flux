import { listApiKeys, tenantApiKeyExists } from "@/actions/tenant-api-key";
import { requirePageCapability } from "@/lib/page-guard";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getCurrentTenantId } from "@/lib/tenant-context";

import { ApiKeyClient } from "./_components/api-key-client";

export default async function ApiSettingsPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/api");

  const [keys, legacy, tenantId] = await Promise.all([
    // Before migration 0047 lands there are no scoped keys to list, and the page still opens.
    tolerateUnmigrated("API keys", () => listApiKeys(), []),
    tenantApiKeyExists(),
    getCurrentTenantId(),
  ]);

  return <ApiKeyClient keys={keys} legacy={legacy} tenantId={tenantId ?? ""} />;
}

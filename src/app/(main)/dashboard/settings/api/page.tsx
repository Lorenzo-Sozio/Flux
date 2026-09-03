import { tenantApiKeyExists } from "@/actions/tenant-api-key";
import { requirePageCapability } from "@/lib/page-guard";
import { getCurrentTenantId } from "@/lib/tenant-context";

import { ApiKeyClient } from "./_components/api-key-client";

export default async function ApiSettingsPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/api");

  const [esiste, tenantId] = await Promise.all([tenantApiKeyExists(), getCurrentTenantId()]);

  return <ApiKeyClient exists={esiste} tenantId={tenantId ?? ""} />;
}

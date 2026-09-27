import { getWebFormSettings } from "@/actions/web-forms";
import { requirePageCapability } from "@/lib/page-guard";

import { FormsClient } from "./_components/forms-client";

export default async function FormsSettingsPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/forms");
  return <FormsClient {...(await getWebFormSettings())} />;
}

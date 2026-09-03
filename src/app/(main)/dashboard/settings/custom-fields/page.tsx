import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { requirePageCapability } from "@/lib/page-guard";

import { CustomFieldsClient } from "./_components/custom-fields-client";

export default async function CustomFieldsPage() {
  const actor = await requirePageCapability("customField:manage", "/dashboard/settings/custom-fields");

  const fields = await getCustomFieldDefinitions();

  return <CustomFieldsClient fields={fields} currentUserId={actor.userId} />;
}

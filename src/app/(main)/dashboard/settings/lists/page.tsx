import { getCompanyLists } from "@/actions/lists";
import { requirePageCapability } from "@/lib/page-guard";

import { ListsClient } from "./_components/lists-client";

export default async function ListsSettingsPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/lists");
  return <ListsClient lists={await getCompanyLists()} />;
}

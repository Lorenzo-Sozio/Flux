import { getCompanyLists } from "@/actions/lists";
import { getRecordSources, getSourceUsage } from "@/actions/record-sources";
import { requirePageCapability } from "@/lib/page-guard";

import { ListsClient } from "./_components/lists-client";

export default async function ListsSettingsPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/lists");
  const [lists, sources, usage] = await Promise.all([getCompanyLists(), getRecordSources(), getSourceUsage()]);
  return <ListsClient lists={lists} sources={sources} sourceUsage={usage} />;
}

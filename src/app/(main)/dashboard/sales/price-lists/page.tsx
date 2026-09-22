import { listPriceLists } from "@/actions/price-lists";
import { hasCapability } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { parseListParams } from "@/lib/pagination";

import { PriceListsClient } from "./_components/price-lists-client";

export default async function PriceListsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePageCapability("record:read", "/dashboard/sales/price-lists");
  const params = await searchParams;
  // The list state lives in the URL, so a search or a filter is shareable and the
  // back button works.
  const listParams = parseListParams(params);
  // ⚠️ `state`, not `filter`: `parseListParams` already claims `filter` for the
  // encoded filter tree the FilterBuilder writes, so reusing it here would hand
  // `decodeFilter` the word "active" the day anybody adds a builder to this screen.
  const filter = params.state ?? "all";

  // ⚠️ Decided on the server, not from a role string in the browser. The actions
  // guard themselves anyway; this is only what stops a viewer being shown buttons
  // that will refuse them.
  const [page, canManage] = await Promise.all([listPriceLists(listParams, filter), hasCapability("product:manage")]);

  return <PriceListsClient page={page} filter={filter} canManage={canManage} />;
}

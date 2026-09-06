import { getOrderStats, listOrders } from "@/actions/orders";
import { parseListParams } from "@/lib/pagination";

import { OrdersClient } from "./_components/orders-client";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  // The list state lives in the URL, so a search or a status filter is shareable
  // and the back button works (audit rilievo B-08).
  const listParams = parseListParams(params);
  const status = params.status ?? "all";

  // The product catalogue used to be loaded here for the creation dialog. The form
  // is its own page now and fetches what it needs, so the list stops paying for it.
  //
  // The stats are counted over every order on purpose: they are the header, and a
  // header that only described the current page would be worse than none.
  const [page, stats] = await Promise.all([listOrders(listParams, status), getOrderStats()]);

  return <OrdersClient page={page} stats={stats} status={status} />;
}

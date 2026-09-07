import { getProductStats, listProducts } from "@/actions/products";
import { parseListParams } from "@/lib/pagination";

import { ProductsClient } from "./_components/products-client";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  // The list state lives in the URL, so a search or a filter is shareable and the
  // back button works (audit rilievo B-08).
  const listParams = parseListParams(params);
  // ⚠️ `state`, not `filter`. `parseListParams` already claims `filter` for the
  // encoded filter tree the FilterBuilder writes, so a catalogue using the same
  // key would hand `decodeFilter` the word "active" the day anybody adds a
  // filter builder here. Quotes and orders use `status` for the same reason.
  const filter = params.state ?? "all";

  // The three figures are counted over the whole catalogue, not over the page:
  // they double as the filter buttons, and a button labelled "inactive 3" that
  // opens on two hundred is worse than no button.
  const [page, stats] = await Promise.all([listProducts(listParams, filter), getProductStats()]);

  return <ProductsClient page={page} stats={stats} filter={filter} />;
}

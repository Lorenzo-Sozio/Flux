import { getQuoteStats, listQuotes } from "@/actions/quotes";
import { parseListParams } from "@/lib/pagination";

import { QuotesClient } from "./_components/quotes-client";

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  // The list state lives in the URL, so a search or a status filter is shareable
  // and the back button works (audit rilievo B-08).
  const listParams = parseListParams(params);
  const status = params.status ?? "all";

  // The figures above the table are counted over the whole workspace, not over
  // the page on screen: a header that only described fifty rows would be worse
  // than no header at all.
  const [page, stats] = await Promise.all([listQuotes(listParams, status), getQuoteStats()]);

  return <QuotesClient page={page} stats={stats} status={status} />;
}

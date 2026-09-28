import { getBankOverview } from "@/actions/bank";
import { requirePageCapability } from "@/lib/page-guard";

import { BankView } from "./_components/bank-view";

/**
 * Bank reconciliation (I13): the account's statement beside what customers owe. Flux proposes
 * where each line goes, with its reasons; a person confirms — one at a time, or the sure ones
 * in bulk. src/lib/bank/ holds the rules.
 */
export default async function BankPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  await requirePageCapability("bank:reconcile", "/dashboard/sales/bank");
  const { account } = await searchParams;
  const data = await getBankOverview(typeof account === "string" ? account : null);
  return <BankView data={JSON.parse(JSON.stringify(data))} />;
}

import { getContracts } from "@/actions/contracts";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { parseListParams } from "@/lib/pagination";
import { can } from "@/lib/permissions";

import { ContractsClient } from "./_components/contracts-client";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePageCapability("record:read", "/dashboard/sales/contracts");
  const params = await searchParams;
  const view = params.view ?? "all";

  const [data, actor] = await Promise.all([getContracts(parseListParams(params), view), getActor()]);

  return (
    <ContractsClient
      data={data}
      view={view}
      canWrite={can(actor, "contract:write")}
      canDelete={can(actor, "contract:delete")}
    />
  );
}

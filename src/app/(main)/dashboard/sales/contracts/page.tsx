import { getContracts } from "@/actions/contracts";
import { getAllUsers, getCompaniesForSelect } from "@/actions/crm";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { ContractsClient } from "./_components/contracts-client";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requirePageCapability("record:read", "/dashboard/sales/contracts");
  const { view } = await searchParams;

  const [data, companies, users, actor] = await Promise.all([
    getContracts(),
    getCompaniesForSelect(),
    getAllUsers(),
    getActor(),
  ]);

  return (
    <ContractsClient
      data={data}
      companies={companies}
      users={users}
      view={view ?? "all"}
      canWrite={can(actor, "contract:write")}
      canDelete={can(actor, "contract:delete")}
    />
  );
}

import { getContractFormData } from "@/actions/contracts";
import { requirePageCapability } from "@/lib/page-guard";

import { ContractForm } from "../_components/contract-form";

/**
 * The pickers are loaded here, like the quote form's: fetching them from the
 * browser draws the page with three empty selects and fills them a moment later.
 */
export default async function NewContractPage() {
  await requirePageCapability("contract:write", "/dashboard/sales/contracts");
  const data = await getContractFormData().catch(() => null);
  return <ContractForm initial={null} data={data} />;
}

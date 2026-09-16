import { notFound } from "next/navigation";

import { getContract, getContractFormData } from "@/actions/contracts";
import { RecordVisit } from "@/components/crm/record-visit";
import { requirePageCapability } from "@/lib/page-guard";

import { ContractForm } from "../_components/contract-form";

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("contract:write", "/dashboard/sales/contracts");
  const [contract, data] = await Promise.all([getContract(id), getContractFormData().catch(() => null)]);
  if (!contract) notFound();

  return (
    <>
      <RecordVisit type="contract" id={contract.id} label={contract.title} />
      <ContractForm
        initial={{
          id: contract.id,
          title: contract.title,
          companyId: contract.companyId ?? "",
          contactId: contract.contactId ?? "",
          ownerId: contract.ownerId ?? "",
          status: contract.status as "draft" | "active" | "cancelled",
          amount: Number(contract.amount),
          currency: contract.currency,
          billingPeriod: contract.billingPeriod as "monthly" | "quarterly" | "semiannual" | "annual",
          startDate: contract.startDate,
          endDate: contract.endDate ?? "",
          autoRenew: contract.autoRenew,
          renewalTermMonths: contract.renewalTermMonths ?? 12,
          noticeDays: contract.noticeDays,
          notes: contract.notes ?? "",
        }}
        data={data}
      />
    </>
  );
}

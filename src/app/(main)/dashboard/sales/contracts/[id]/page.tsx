import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import { MailIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getContract, getContractFormData } from "@/actions/contracts";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { RecordVisit } from "@/components/crm/record-visit";
import { buttonVariants } from "@/components/ui/button";
import { companies, contacts } from "@/db/schema";
import { currentTermEnd } from "@/lib/contract-terms";
import { documentLanguage, formatDocumentDate, formatDocumentMoney } from "@/lib/document-language";
import { documentValues } from "@/lib/email-placeholders";
import { requirePageCapability } from "@/lib/page-guard";
import { getDb } from "@/lib/tenant-context";
import { toWallDate } from "@/lib/wall-clock";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { ContractForm } from "../_components/contract-form";

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("contract:write", "/dashboard/sales/contracts");
  const [contract, data] = await Promise.all([getContract(id), getContractFormData().catch(() => null)]);
  if (!contract) notFound();

  // Who to write to about it — the contact, else the company's own address — and what the email
  // knows: its title and the end of the term now running, renewals included.
  const db = await getDb();
  const [[contact], [company], timeZone, tR] = await Promise.all([
    contract.contactId
      ? db
          .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
          .from(contacts)
          .where(eq(contacts.id, contract.contactId))
      : Promise.resolve([]),
    contract.companyId
      ? db
          .select({
            name: companies.name,
            email: companies.mainEmail,
            language: companies.language,
            country: companies.country,
          })
          .from(companies)
          .where(eq(companies.id, contract.companyId))
      : Promise.resolve([]),
    getWorkspaceTimeZone(),
    getTranslations("record"),
  ]);
  const lang = documentLanguage(company ?? null);
  const termEnd = currentTermEnd(
    {
      ...contract,
      status: contract.status as "draft" | "active" | "cancelled",
      amount: Number(contract.amount),
      billingPeriod: contract.billingPeriod as "monthly" | "quarterly" | "semiannual" | "annual",
    },
    toWallDate(new Date(), timeZone),
  );
  const fields = documentValues({
    contractReference: contract.title,
    contractEndDate: termEnd ? formatDocumentDate(termEnd, lang) : null,
    amount: formatDocumentMoney(contract.amount, contract.currency, lang),
  });
  const to = contact?.email
    ? {
        email: contact.email,
        entity: { id: contract.contactId ?? "", ...contact, companyName: company?.name },
        entityType: "contact" as const,
      }
    : company?.email && contract.companyId
      ? { email: company.email, entity: { id: contract.companyId, name: company.name }, entityType: "company" as const }
      : null;

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
        emailAction={
          to && (
            <EmailAddressButton
              {...to}
              dealId={contract.dealId ?? undefined}
              fields={fields}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <MailIcon className="size-3.5" aria-hidden />
              {tR("email")}
            </EmailAddressButton>
          )
        }
      />
    </>
  );
}

import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { getInvoice, getInvoicePayments } from "@/actions/invoices";
import { RecordBackLink, RecordPage } from "@/components/crm/record/record-page";
import { RecordVisit } from "@/components/crm/record-visit";
import { orders } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

import { InvoiceView } from "./_components/invoice-view";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("record:read", `/dashboard/sales/invoices/${id}`);
  const [data, actor, t] = await Promise.all([getInvoice(id), getActor(), getTranslations("invoices")]);
  if (!data) notFound();

  // The order it was written from, by number: `invoice.order_id` was on the row and
  // the page never said where the invoice came from. A deleted order leaves the id
  // null (on delete set null), so a miss here is simply no link.
  let orderNumber: string | null = null;
  if (data.invoice.orderId) {
    const db = await getDb();
    const [order] = await db
      .select({ number: orders.orderNumber })
      .from(orders)
      .where(eq(orders.id, data.invoice.orderId));
    orderNumber = order?.number ?? null;
  }

  // Only an issued invoice is owed anything; a credit note is money going the other way.
  const payments =
    data.invoice.status === "issued" && ["TD01", "TD02"].includes(data.invoice.documentType)
      ? await getInvoicePayments(id)
      : null;

  // A draft has no number yet: the customer is what names it until it is issued.
  const visitType = data.invoice.documentType === "TD04" ? "creditNote" : "invoice";
  const visitLabel = data.invoice.documentNumber ?? `${data.companyName ?? ""} · ${t("draftNumber")}`;

  return (
    <RecordPage>
      <RecordVisit
        type={visitType}
        id={data.invoice.id}
        label={visitLabel}
        sub={data.invoice.documentNumber ? data.companyName : null}
      />
      <RecordBackLink href="/dashboard/sales/invoices">{t("back")}</RecordBackLink>
      <InvoiceView
        data={JSON.parse(JSON.stringify(data))}
        canWrite={can(actor, "invoice:write")}
        canIssue={can(actor, "invoice:issue")}
        orderNumber={orderNumber}
        payments={payments ? JSON.parse(JSON.stringify(payments)) : null}
      />
    </RecordPage>
  );
}

import { notFound } from "next/navigation";

import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { getInvoice, getInvoicePayments } from "@/actions/invoices";
import { RecordBackLink, RecordPage } from "@/components/crm/record/record-page";
import { RecordVisit } from "@/components/crm/record-visit";
import { orders } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { sdiProvider } from "@/lib/sdi/registry";
import { readSdiSettings } from "@/lib/sdi/transmit";
import type { SdiChannel } from "@/lib/sdi/types";
import { getDb } from "@/lib/tenant-context";

import { InvoiceView } from "./_components/invoice-view";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("record:read", `/dashboard/sales/invoices/${id}`);
  const [data, actor, t] = await Promise.all([getInvoice(id), getActor(), getTranslations("invoices")]);
  if (!data) notFound();

  // The order's number, the payments and the SDI channel are independent: read side by side.
  // The order it was written from, by number: `invoice.order_id` was on the row and
  // the page never said where the invoice came from. A deleted order leaves the id
  // null (on delete set null), so a miss here is simply no link.
  // Only an issued invoice is owed anything; a credit note is money going the other way.
  // How the workspace reaches SDI: by hand, or through an intermediary (src/lib/sdi/).
  const db = await getDb();
  const orderId = data.invoice.orderId;
  const [orderNumber, payments, sdiSettings] = await Promise.all([
    orderId
      ? db
          .select({ number: orders.orderNumber })
          .from(orders)
          // One's own invoice can be on a colleague's order: then it names none.
          .where(and(eq(orders.id, orderId), visibleWhere("order", await recordScope())))
          .then((rows) => rows[0]?.number ?? null)
      : Promise.resolve(null),
    data.invoice.status === "issued" && ["TD01", "TD02"].includes(data.invoice.documentType)
      ? getInvoicePayments(id)
      : Promise.resolve(null),
    tolerateUnmigrated("sdi settings", async () => readSdiSettings(db), null),
  ]);
  const provider = sdiProvider(sdiSettings?.channel);
  const sdi = { channel: (provider?.id ?? "manual") as SdiChannel, providerLabel: provider?.label ?? null };

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
        sdi={sdi}
      />
    </RecordPage>
  );
}

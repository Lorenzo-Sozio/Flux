import { getNewInvoiceData, getOrderForInvoice } from "@/actions/invoices";
import { getActor } from "@/lib/auth-guard";
import { italianToday } from "@/lib/invoice-draft";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { blankLine, editableFields } from "../_components/invoice-lines";
import { NewInvoiceForm } from "./_components/new-invoice-form";

/**
 * `?order=<id>` arrives from an order's page and opens the form already filled in
 * from that order, so there is one place an invoice is written.
 */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  await requirePageCapability("invoice:write", "/dashboard/sales/invoices");
  const { order } = await searchParams;
  const [data, actor, fromOrder] = await Promise.all([
    getNewInvoiceData(),
    getActor(),
    order ? getOrderForInvoice(order) : Promise.resolve(null),
  ]);

  const initialOrder =
    order && fromOrder
      ? {
          id: order,
          companyId: fromOrder.companyId,
          currency: fromOrder.currency,
          discountPercent: fromOrder.discountPercent,
          lines: fromOrder.lines.length
            ? fromOrder.lines.map((l, i) => ({ ...editableFields(l), key: `o${i}` }))
            : [blankLine()],
        }
      : null;

  return (
    <NewInvoiceForm
      data={data}
      today={italianToday()}
      initialOrder={initialOrder}
      canIssue={can(actor, "invoice:issue")}
    />
  );
}

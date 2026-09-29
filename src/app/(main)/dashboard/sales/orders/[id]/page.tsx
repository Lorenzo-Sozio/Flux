import Link from "next/link";

import { and, asc, eq } from "drizzle-orm";
import {
  BuildingIcon,
  ChevronDownIcon,
  FileTextIcon,
  InfoIcon,
  LifeBuoyIcon,
  PackageIcon,
  ReceiptIcon,
  ShoppingCart,
  UserIcon,
  UserRoundIcon,
  WalletIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { getOrderById, getOrderInvoicesToPay, getOrderPayments } from "@/actions/orders";
import { getProductsForSelect } from "@/actions/products";
import { getTicketsForOrder } from "@/actions/support";
import {
  EmptyHint,
  Field,
  FieldList,
  MetaItem,
  Metric,
  MetricStrip,
  RecordBackLink,
  RecordHero,
  RecordPage,
  RelatedRow,
  StatusBadge,
} from "@/components/crm/record/record-page";
import { RecordSections } from "@/components/crm/record/record-sections";
import { RecordVisit } from "@/components/crm/record-visit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deals, invoices, orders, quotes } from "@/db/schema";
import { paymentSummary } from "@/lib/order-payment";
import { isTerminalStatus } from "@/lib/order-status";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { CreateInvoiceButton } from "./_components/create-invoice-button";
import { DepositInvoiceButton } from "./_components/deposit-invoice-button";
import { AdvanceStatusButton, OrderMoreMenu } from "./_components/order-actions";
import { OrderLines } from "./_components/order-lines";
import { ORDER_STATUS_TONE, PAYMENT_TONE } from "./_components/order-tones";
import { PaymentsCard } from "./_components/payments-card";

const DAY = 86_400_000;

/** Today's calendar date on the workspace's clock, as YYYY-MM-DD — never the server's (UTC on Workers). */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** Whole days from one calendar date to another, both YYYY-MM-DD: no clock, so no summer-time hour. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * One order, laid out for whoever has to fulfil it and get it paid.
 *
 * ⚠️ The order of the screen is the order of the questions: what state is it in
 * and what is the next move (the hero), how much, how much has arrived and is any
 * of it late (the figures), what was ordered and what has been paid (the work
 * column), and who, where from, which invoices (the side column).
 *
 * This page used to be a client component that fetched its own order in an
 * effect, so nothing rendered until three round trips had come back and every
 * change patched a local copy. It is a server component now, like the other
 * record pages: one read, and a change refreshes the route so the hero's figures
 * and the cards under it are drawn from the same rows.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePageCapability("record:read", `/dashboard/sales/orders/${id}`);
  // A viewer reads the order; the controls that would only answer "forbidden" are
  // not drawn for them. The same capabilities the actions check.
  const canWrite = can(actor, "order:write");
  const canDelete = can(actor, "order:delete");
  const canInvoice = can(actor, "invoice:write");
  const db = await getDb();

  const [
    order,
    payments,
    invoicesToPay,
    products,
    ticketsAbout,
    orderInvoices,
    [fromQuote],
    [fromDeal],
    timeZone,
    t,
    tP,
    tStatus,
    tInv,
    tX,
    tR,
    tEntity,
    format,
  ] = await Promise.all([
    getOrderById(id),
    getOrderPayments(id),
    // The issued invoices a payment on this order can pay, with what each still owes (I10).
    getOrderInvoicesToPay(id),
    // The add-line dialog's catalogue, and only for somebody who can add a line.
    canWrite ? getProductsForSelect() : Promise.resolve([]),
    // An order could be prepared, shipped and closed while a conversation about it
    // ran in the support module, and nothing here said so.
    getTicketsForOrder(id).catch(() => []),
    // Which invoices this order became. `invoice.order_id` has been written since
    // invoicing from an order existed; nothing on the order showed it, so the only
    // way to know whether an order had been invoiced was to try again and be refused.
    tolerateUnmigrated(
      "invoices",
      () =>
        db
          .select({
            id: invoices.id,
            documentType: invoices.documentType,
            status: invoices.status,
            documentNumber: invoices.documentNumber,
            issueDate: invoices.issueDate,
            dueDate: invoices.dueDate,
            total: invoices.total,
            creditedAmount: invoices.creditedAmount,
            currency: invoices.currency,
          })
          .from(invoices)
          .where(eq(invoices.orderId, id))
          .orderBy(asc(invoices.createdAt)),
      [],
    ),
    // Where the order came from, by name: the ids have been on the row since the
    // conversion from a quote was wired up (audit rilievo D-06).
    db
      .select({ id: quotes.id, number: quotes.quoteNumber })
      .from(quotes)
      .innerJoin(orders, and(eq(orders.quoteId, quotes.id), eq(orders.id, id))),
    db
      .select({ id: deals.id, name: deals.name })
      .from(deals)
      .innerJoin(orders, and(eq(orders.dealId, deals.id), eq(orders.id, id))),
    getWorkspaceTimeZone(),
    getTranslations("orders.detail"),
    getTranslations("orders.payments"),
    getTranslations("orders.statuses"),
    getTranslations("invoices"),
    getTranslations("pipeline.detail"),
    getTranslations("record"),
    getTranslations("entities.statuses"),
    getFormatter(),
  ]);

  if (!order) {
    return (
      <div className="py-20 text-center">
        <ShoppingCart className="mx-auto mb-4 size-12 text-muted-foreground/30" aria-hidden />
        <p className="mb-4 text-muted-foreground">{t("notFound")}</p>
        <Button asChild>
          <Link href="/dashboard/sales/orders">{t("back")}</Link>
        </Button>
      </div>
    );
  }

  // ── Derived ──
  const money = (value: number | string | null | undefined, currency: string) =>
    format.number(Number(value ?? 0), { style: "currency", currency: currency || "EUR" });
  const day = (value: Date | string) => format.dateTime(new Date(value), { dateStyle: "medium", timeZone });
  // Day and time: on an order taken by phone at 09:10 and another at 17:40 that is
  // the difference between knowing the sequence and guessing it.
  const dayTime = (value: Date | string) =>
    format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone });
  const statusLabel = (s: string) => (tStatus.has(s as never) ? tStatus(s as never) : s);
  const entityStatus = (s: string) => (tEntity.has(s as never) ? tEntity(s as never) : s);

  const contactName = [order.contactFirstName, order.contactLastName].filter(Boolean).join(" ");
  const summary = paymentSummary(order.totalAmount, payments);
  const terminal = isTerminalStatus(order.status);

  // An order is invoiced once an invoice for it is issued — the rule the new-invoice
  // page uses to decide which orders it offers. One with only a draft opens the draft.
  const invoiceDocs = orderInvoices.filter((i) => i.documentType === "TD01");
  // ⚠️ An invoice credited back in full no longer invoices the order: it can be invoiced again,
  // and its deposits were given back by the credit note (src/lib/invoice-issue.ts).
  const stillCounts = (i: { status: string; total: string | null; creditedAmount: string | null }) =>
    i.status === "issued" && Number(i.creditedAmount ?? 0) < Number(i.total ?? 0);
  const issuedInvoice = invoiceDocs.find(stillCounts);
  // Invoiced, its lines are fixed: the server refuses a change, and the page offers none.
  const linesFrozen = orderInvoices.some(
    (i) => (i.documentType === "TD01" || i.documentType === "TD02") && stillCounts(i),
  );
  const draftInvoice = invoiceDocs.find((i) => i.status === "draft");
  const offerInvoice = canInvoice && order.status !== "cancelled" && !issuedInvoice;
  // I11: deposit invoices (TD02) for part of the order, and the balance that takes them off.
  const deposits = orderInvoices.filter((i) => i.documentType === "TD02");
  const hasIssuedDeposit = deposits.some((i) => i.status === "issued");
  // What is left to invoice: the order less every invoice and deposit invoice written for it.
  // Net of credit notes, and drafts included: a draft is about to invoice it.
  const invoicedSoFar = orderInvoices
    .filter((i) => i.documentType === "TD01" || i.documentType === "TD02")
    .reduce((sum, i) => sum + Number(i.total ?? 0) - Number(i.creditedAmount ?? 0), 0);
  const leftToInvoice = Math.max(0, Math.round((Number(order.totalAmount ?? 0) - invoicedSoFar) * 100) / 100);
  // Money received on the order that no invoice carries yet: a deposit to invoice.
  const depositNotInvoiced =
    Math.round(payments.filter((p) => !p.invoiceId).reduce((sum, p) => sum + Number(p.amount ?? 0), 0) * 100) / 100;

  // The balance is late when the invoice asked for it by a date that has passed.
  // An order carries no due date of its own; its issued invoice does.
  const today = todayIn(timeZone);
  const dueDate =
    [...invoiceDocs, ...deposits]
      .filter((i) => i.status === "issued" && i.dueDate)
      .map((i) => i.dueDate as string)
      .sort()[0] ?? null;
  const owing = summary.outstanding > 0;
  const daysToDue = dueDate ? daysBetween(today, dueDate) : null;
  const balanceOverdue = owing && daysToDue != null && daysToDue < 0;
  const balanceHint =
    owing && daysToDue != null
      ? daysToDue === 0
        ? tR("today")
        : daysToDue < 0
          ? tR("overdueBy", { days: -daysToDue })
          : tR("inDays", { days: daysToDue })
      : tP(`state.${summary.state}`);

  const invoiceTitle = (i: (typeof orderInvoices)[number]) =>
    i.documentType === "TD04"
      ? i.documentNumber
        ? tInv("credit.noteNumber", { number: i.documentNumber })
        : tInv("credit.draftNote")
      : i.documentType === "TD02"
        ? i.documentNumber
          ? tInv("deposit.numberTitle", { number: i.documentNumber })
          : tInv("deposit.draftTitle")
        : i.documentNumber
          ? tInv("numberTitle", { number: i.documentNumber })
          : tInv("draftTitle");

  // ── Sections ──
  const details = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("orderDetails")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={tX("fieldCompany")}>
            {order.companyName &&
              (order.companyId ? (
                <Link href={`/dashboard/companies/${order.companyId}`} className="text-primary hover:underline">
                  {order.companyName}
                </Link>
              ) : (
                order.companyName
              ))}
          </Field>
          <Field label={tX("fieldContact")}>
            {contactName && (
              <div className="min-w-0 space-y-0.5">
                {order.contactId ? (
                  <Link href={`/dashboard/contacts/${order.contactId}`} className="text-primary hover:underline">
                    {contactName}
                  </Link>
                ) : (
                  <span>{contactName}</span>
                )}
                {order.contactEmail && (
                  <a
                    href={`mailto:${order.contactEmail}`}
                    className="block truncate text-muted-foreground text-xs hover:text-foreground"
                  >
                    {order.contactEmail}
                  </a>
                )}
              </div>
            )}
          </Field>
          <Field label={t("owner")} always>
            {order.ownerName ?? tR("unassigned")}
          </Field>
          <Field label={t("orderDate")} always>
            <span className="tabular-nums">{dayTime(order.orderDate)}</span>
          </Field>
          <Field label={tP("deliveredOn")}>
            {order.deliveredAt && <span className="tabular-nums">{day(order.deliveredAt)}</span>}
          </Field>
          <Field label={t("sourceQuote")}>
            {fromQuote && (
              <Link href={`/dashboard/sales/quotes/${fromQuote.id}`} className="text-primary hover:underline">
                {fromQuote.number}
              </Link>
            )}
          </Field>
          <Field label={t("sourceDeal")}>
            {fromDeal && (
              <Link href={`/dashboard/pipeline/${fromDeal.id}`} className="text-primary hover:underline">
                {fromDeal.name}
              </Link>
            )}
          </Field>
        </FieldList>

        {/* What has to be known to prepare it: pickup or delivery, when, where.
            Written by whoever took the order — an assistant, or a person. */}
        <div className="border-t pt-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs">{t("notes")}</p>
          {order.notes ? (
            <p className="whitespace-pre-line break-words text-sm">{order.notes}</p>
          ) : (
            <p className="text-muted-foreground text-sm">—</p>
          )}
        </div>

        {/* When the record was written and last touched: asked for rarely, so folded. */}
        <details className="group/more rounded-md border">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
            {tR("showMore")}
            <ChevronDownIcon className="size-4 transition-transform group-open/more:rotate-180" aria-hidden />
          </summary>
          <FieldList className="border-t px-3 py-3">
            <Field label={t("created")}>
              <span className="tabular-nums">{dayTime(order.createdAt)}</span>
            </Field>
            <Field label={tR("updated")}>
              <span className="tabular-nums">{dayTime(order.updatedAt)}</span>
            </Field>
          </FieldList>
        </details>
      </CardContent>
    </Card>
  );

  const invoicesCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptIcon className="size-4 text-muted-foreground" aria-hidden />
          {tR("tabs.invoices")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {offerInvoice && depositNotInvoiced > 0 && (
          // A payment received in advance is invoiced when it arrives.
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50/70 p-2.5 text-amber-900 text-xs dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
            {tInv("deposit.receivedNotInvoiced", { amount: money(depositNotInvoiced, order.currency) })}
          </p>
        )}
        {orderInvoices.length === 0 ? (
          <EmptyHint>{t("noInvoices")}</EmptyHint>
        ) : (
          <ul className="space-y-2">
            {orderInvoices.map((inv) => (
              <li key={inv.id}>
                <RelatedRow
                  href={`/dashboard/sales/invoices/${inv.id}`}
                  title={invoiceTitle(inv)}
                  sub={inv.issueDate ? day(`${inv.issueDate}T12:00:00Z`) : tInv(`types.${inv.documentType as "TD01"}`)}
                  aside={
                    <>
                      {/* In the invoice's own currency, which need not be the order's. */}
                      <span className="font-semibold tabular-nums">{money(inv.total, inv.currency)}</span>
                      <StatusBadge tone={inv.status === "issued" ? "success" : "neutral"} className="text-[11px]">
                        {tInv(`statuses.${inv.status as "draft" | "issued"}`)}
                      </StatusBadge>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {offerInvoice && !draftInvoice && (
          <div className="mt-3 flex flex-wrap gap-2">
            <DepositInvoiceButton
              orderId={order.id}
              left={leftToInvoice}
              total={Number(order.totalAmount ?? 0)}
              leftText={money(leftToInvoice, order.currency)}
              suggested={depositNotInvoiced > 0 ? Math.min(depositNotInvoiced, leftToInvoice) : undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );

  // What the customer has said about it, if anything.
  const ticketsCard =
    ticketsAbout.length > 0 ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoyIcon className="size-4 text-muted-foreground" aria-hidden />
            {t("openTickets")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {ticketsAbout.map((tk) => (
              <li key={tk.id}>
                <RelatedRow
                  href={`/dashboard/support/tickets/${tk.id}`}
                  title={tk.subject}
                  sub={tk.ticketNumber}
                  aside={
                    <StatusBadge tone={tk.breachedAt ? "danger" : "neutral"} className="text-[11px]">
                      {entityStatus(tk.status)}
                    </StatusBadge>
                  }
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    ) : null;

  return (
    <RecordPage>
      <RecordVisit type="order" id={order.id} label={order.orderNumber} sub={order.companyName ?? null} />
      <RecordBackLink href="/dashboard/sales/orders">{t("allOrders")}</RecordBackLink>

      {/* ── Hero: which order, whose, where it stands, and the next move ── */}
      <RecordHero
        badges={
          <>
            <StatusBadge tone={ORDER_STATUS_TONE[order.status] ?? "neutral"}>{statusLabel(order.status)}</StatusBadge>
            {/* Money is only chased on an order that is going ahead: a draft is not
                "unpaid" in any sense worth a red badge. */}
            {(order.status === "processing" || order.status === "completed") && Number(order.totalAmount) > 0 && (
              <StatusBadge tone={PAYMENT_TONE[summary.state]}>
                <WalletIcon aria-hidden />
                {tP(`state.${summary.state}`)}
              </StatusBadge>
            )}
          </>
        }
        title={order.orderNumber}
        meta={
          <>
            {order.companyName && (
              <MetaItem
                icon={<BuildingIcon aria-hidden />}
                href={order.companyId ? `/dashboard/companies/${order.companyId}` : null}
              >
                {order.companyName}
              </MetaItem>
            )}
            {contactName && (
              <MetaItem
                icon={<UserIcon aria-hidden />}
                href={order.contactId ? `/dashboard/contacts/${order.contactId}` : null}
              >
                {contactName}
              </MetaItem>
            )}
            <MetaItem icon={<UserRoundIcon aria-hidden />}>
              {order.ownerName ? tR("assignedTo", { name: order.ownerName }) : tR("unassigned")}
            </MetaItem>
          </>
        }
        actions={
          // A viewer with nothing to do gets no empty action row under the title.
          (canWrite || offerInvoice || canDelete) && (
            <>
              {canWrite && <AdvanceStatusButton orderId={order.id} status={order.status} />}
              {offerInvoice && (
                <CreateInvoiceButton
                  orderId={order.id}
                  // A deposit invoice still in draft is issued or deleted before the balance: the
                  // button opens it rather than a form that would only refuse.
                  draftId={draftInvoice?.id ?? deposits.find((i) => i.status === "draft")?.id ?? null}
                  variant={canWrite && !terminal ? "outline" : "default"}
                  balance={hasIssuedDeposit}
                />
              )}
              <OrderMoreMenu orderId={order.id} status={order.status} canWrite={canWrite} canDelete={canDelete} />
            </>
          )
        }
      >
        {/* The four figures an order is chased by. */}
        <MetricStrip>
          <Metric label={t("totalAmount")}>{money(order.totalAmount, order.currency)}</Metric>
          <Metric label={tP("paid")} tone={summary.state === "paid" && summary.paid > 0 ? "success" : undefined}>
            {money(summary.paid, order.currency)}
          </Metric>
          <Metric
            label={summary.outstanding < 0 ? tP("credit") : tP("outstanding")}
            tone={balanceOverdue ? "danger" : undefined}
            hint={balanceHint}
          >
            {money(Math.abs(summary.outstanding), order.currency)}
          </Metric>
          {order.deliveredAt ? (
            <Metric label={tP("deliveredOn")}>{day(order.deliveredAt)}</Metric>
          ) : (
            <Metric label={t("orderDate")}>{day(order.orderDate)}</Metric>
          )}
        </MetricStrip>

        {terminal && (
          <p className="text-muted-foreground text-sm">
            {order.status === "completed" ? t("closedHint") : t("cancelledHint")}
          </p>
        )}
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "lines", label: tR("tabs.lines"), icon: <PackageIcon aria-hidden />, count: order.items.length },
          { id: "payments", label: tR("tabs.payments"), icon: <WalletIcon aria-hidden />, count: payments.length },
          {
            id: "invoices",
            label: tR("tabs.invoices"),
            icon: <FileTextIcon aria-hidden />,
            count: orderInvoices.length,
          },
          { id: "details", label: tR("tabs.details"), icon: <InfoIcon aria-hidden />, count: ticketsAbout.length },
        ]}
        sections={[
          {
            tab: "lines",
            column: "main",
            node: (
              <OrderLines
                orderId={order.id}
                items={order.items}
                currency={order.currency}
                totalAmount={order.totalAmount}
                companyId={order.companyId}
                products={products}
                canWrite={canWrite && !linesFrozen}
              />
            ),
          },
          {
            tab: "payments",
            column: "main",
            node: (
              <PaymentsCard
                orderId={order.id}
                totalAmount={order.totalAmount}
                currency={order.currency}
                deliveredAt={order.deliveredAt ?? null}
                payments={payments}
                invoices={invoicesToPay}
                canWrite={canWrite}
                canInvoice={canInvoice}
                today={today}
              />
            ),
          },
          { tab: "details", column: "side", node: details },
          { tab: "invoices", column: "side", node: invoicesCard },
          ...(ticketsCard ? [{ tab: "details", column: "side" as const, node: ticketsCard }] : []),
        ]}
      />
    </RecordPage>
  );
}

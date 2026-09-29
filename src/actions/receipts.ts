"use server";

import { revalidatePath } from "next/cache";

import { desc, eq, inArray } from "drizzle-orm";

import { invoices, orderPayments, receipts, users } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { serverT } from "@/lib/i18n-server";
import { paymentDay } from "@/lib/order-payment";
import {
  allocateCredit,
  customerCredit,
  openCredits,
  type ReceiptRefusal,
  recordReceipt,
  recordRefund,
  releaseOverpayment,
  type Settled,
  updateReceipt,
} from "@/lib/receipts";
import { receivables } from "@/lib/receivables";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";
import { toWallDate } from "@/lib/wall-clock";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

/**
 * Receipts from a customer's side (I10): money that arrived, what it paid, and what is left as
 * the customer's credit. The arithmetic and the rules are in src/lib/receipts.ts; these check
 * who may, and say what happened in the reader's language.
 *
 * ⚠️ Changing what an invoice owes asks for `invoice:write`, whichever page it starts from.
 */

type Outcome = { ok: true } | { ok: false; error: string };

async function refusal(reason: ReceiptRefusal | "invalid_date"): Promise<Outcome> {
  return { ok: false, error: (await serverT("serverErrors.invoices"))(`payment.${reason}`) };
}

function announcePaid(settled: Settled[], actor: string) {
  for (const s of settled) {
    dispatchWebhook("invoice.paid", { id: s.invoiceId, paid: s.paid, due: s.due }, { via: "user", actor }).catch(
      (err) => console.error("[receipts] invoice.paid not dispatched", err),
    );
  }
}

function refresh(input: { companyId?: string | null; invoiceIds?: string[]; orderIds?: string[] }) {
  for (const id of input.invoiceIds ?? []) revalidatePath(`/dashboard/sales/invoices/${id}`);
  for (const id of input.orderIds ?? []) revalidatePath(`/dashboard/sales/orders/${id}`);
  if (input.companyId) revalidatePath(`/dashboard/companies/${input.companyId}`);
  revalidatePath("/dashboard/sales/finance");
}

/** A customer's money: credit, receipts with credit left, invoices still owed, recent receipts. */
export async function getCustomerMoney(companyId: string) {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  return tolerateUnmigrated(
    "receipts",
    async () => {
      const [credit, credits, owed, recent] = await Promise.all([
        customerCredit(db, companyId),
        openCredits(db, companyId),
        receivables(db, { today: toWallDate(new Date(), timeZone), companyId }),
        db
          .select({
            id: receipts.id,
            amount: receipts.amount,
            currency: receipts.currency,
            receivedAt: receipts.receivedAt,
            method: receipts.method,
            reference: receipts.reference,
            note: receipts.note,
            recordedBy: users.name,
          })
          .from(receipts)
          .leftJoin(users, eq(users.id, receipts.recordedById))
          .where(eq(receipts.companyId, companyId))
          .orderBy(desc(receipts.receivedAt))
          .limit(20),
      ]);
      const allocations =
        recent.length > 0
          ? await db
              .select({
                receiptId: orderPayments.receiptId,
                amount: orderPayments.amount,
                invoiceId: orderPayments.invoiceId,
                invoiceNumber: invoices.documentNumber,
                orderId: orderPayments.orderId,
              })
              .from(orderPayments)
              .leftJoin(invoices, eq(invoices.id, orderPayments.invoiceId))
              .where(
                inArray(
                  orderPayments.receiptId,
                  recent.map((r) => r.id),
                ),
              )
          : [];
      return {
        // The workspace's day: the browser's clock put an evening payment a day ahead of it.
        today: toWallDate(new Date(), timeZone),
        credit,
        credits,
        owed: owed.invoices,
        receipts: recent.map((r) => ({
          ...r,
          allocations: allocations.filter((a) => a.receiptId === r.id),
        })),
      };
    },
    null,
  );
}

/**
 * One transfer from a customer, allocated to their invoices as the person chose; what it does
 * not allocate stays as their credit.
 */
export async function recordCustomerReceiptAction(
  companyId: string,
  data: {
    amount: number | string;
    paidAt?: string;
    method?: string;
    reference?: string;
    note?: string;
    /** The currency the card showed: needed when nothing is allocated, the money all credit. */
    currency?: string;
    allocations: { invoiceId: string; amount: number | string }[];
  },
): Promise<Outcome> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const receivedAt = paymentDay(data.paidAt, timeZone);
  if (!receivedAt) return refusal("invalid_date");
  const result = await recordReceipt(db, {
    companyId,
    amount: data.amount,
    receivedAt,
    method: data.method,
    reference: data.reference,
    note: data.note,
    // ⚠️ Without it a credit-only receipt from a customer billed in dollars was stored in euros.
    currency: typeof data.currency === "string" && /^[A-Z]{3}$/.test(data.currency) ? data.currency : null,
    by: actor.userId,
    // Only the shares left blank are dropped; one that is not a number is refused, not ignored.
    allocations: data.allocations.filter(
      (a) => String(a.amount ?? "").trim() !== "" && Number(String(a.amount).replace(",", ".")) !== 0,
    ),
  });
  if (!result.ok) return refusal(result.reason);
  announcePaid(result.settled, actor.userId);
  refresh({ companyId, invoiceIds: data.allocations.map((a) => a.invoiceId) });
  return { ok: true };
}

/** Part of a customer's credit, spent on one of their invoices. */
export async function allocateCreditAction(
  receiptId: string,
  invoiceId: string,
  amount: number | string,
): Promise<Outcome> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const result = await allocateCredit(db, { receiptId, invoiceId, amount, by: actor.userId });
  if (!result.ok) return refusal(result.reason);
  announcePaid(result.settled, actor.userId);
  const [receipt] = await db.select({ companyId: receipts.companyId }).from(receipts).where(eq(receipts.id, receiptId));
  refresh({ companyId: receipt?.companyId, invoiceIds: [invoiceId] });
  return { ok: true };
}

/** Corrects a receipt: day, amount, method, reference, note. */
export async function updateReceiptAction(
  receiptId: string,
  data: { amount?: number | string; paidAt?: string; method?: string; reference?: string; note?: string },
): Promise<Outcome> {
  const actor = await requireCapability("record:write");
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  // Who may: the permission of what the money paid — an invoice's, else an order's.
  const shares = await db
    .select({ invoiceId: orderPayments.invoiceId, orderId: orderPayments.orderId })
    .from(orderPayments)
    .where(eq(orderPayments.receiptId, receiptId));
  if (shares.some((s: { invoiceId: string | null }) => s.invoiceId) || shares.length === 0)
    await requireCapability("invoice:write");
  else await requireCapability("order:write");

  const receivedAt = data.paidAt !== undefined ? paymentDay(data.paidAt, timeZone) : undefined;
  if (receivedAt === null) return refusal("invalid_date");
  const result = await updateReceipt(db, {
    receiptId,
    amount: data.amount,
    receivedAt,
    method: data.method,
    reference: data.reference,
    note: data.note,
    by: actor.userId,
  });
  if (!result.ok) return refusal(result.reason);
  // A correction that settles an invoice tells the integrations, as a payment would.
  announcePaid(result.settled, actor.userId);
  const [receipt] = await db.select({ companyId: receipts.companyId }).from(receipts).where(eq(receipts.id, receiptId));
  refresh({ companyId: receipt?.companyId, invoiceIds: result.invoiceIds, orderIds: result.orderIds });
  return { ok: true };
}

/** Money given back: on an overpaid invoice, or out of the customer's credit. */
export async function recordRefundAction(input: {
  invoiceId?: string;
  companyId?: string;
  currency?: string;
  amount: number | string;
  paidAt?: string;
  method?: string;
  reference?: string;
  note?: string;
}): Promise<Outcome> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const receivedAt = paymentDay(input.paidAt, timeZone);
  if (!receivedAt) return refusal("invalid_date");
  const result = await recordRefund(db, {
    invoiceId: input.invoiceId,
    companyId: input.companyId,
    currency: input.currency,
    amount: input.amount,
    receivedAt,
    method: input.method,
    reference: input.reference,
    note: input.note,
    by: actor.userId,
  });
  if (!result.ok) return refusal(result.reason);
  // A refund on an invoice changes the customer's card and statement too.
  const [owner] = input.invoiceId
    ? await db.select({ companyId: invoices.companyId }).from(invoices).where(eq(invoices.id, input.invoiceId))
    : [];
  refresh({
    companyId: input.companyId ?? owner?.companyId ?? null,
    invoiceIds: input.invoiceId ? [input.invoiceId] : [],
  });
  return { ok: true };
}

/**
 * Moves what an invoice was paid beyond what it owes to the customer's credit, where the next
 * invoice can use it — after a credit note, or a payment recorded twice.
 */
export async function releaseOverpaymentAction(invoiceId: string): Promise<Outcome & { moved?: number }> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const moved = await releaseOverpayment(db, invoiceId);
  const [invoice] = await db.select({ companyId: invoices.companyId }).from(invoices).where(eq(invoices.id, invoiceId));
  refresh({ companyId: invoice?.companyId, invoiceIds: [invoiceId] });
  return { ok: true, moved };
}

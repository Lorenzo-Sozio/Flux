"use server";

import { revalidatePath } from "next/cache";

import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import {
  type AccountRefusal,
  archiveAccount,
  bankQueue,
  type ConfirmRefusal,
  confirmLine,
  confirmSure,
  createAccount,
  doneLines,
  ignoreLines,
  importMovements,
  listAccounts,
  restoreLine,
  saveCsvMapping,
  undoLine,
  updateAccount,
} from "@/lib/bank/reconcile";
import { serverT } from "@/lib/i18n-server";
import type { Settled } from "@/lib/receipts";
import { customerCredit } from "@/lib/receipts";
import { receivables } from "@/lib/receivables";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";
import { toWallDate } from "@/lib/wall-clock";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

/**
 * Bank reconciliation (I13): who may, and what happened in the reader's language. The rules
 * are in src/lib/bank/reconcile.ts.
 *
 * ⚠️ Everything here asks for `bank:reconcile` (admin), reading included: a statement is every
 * movement on the account, not only what customers paid.
 */

type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function refusal(
  reason: ConfirmRefusal | AccountRefusal | "mapping" | "too_many",
): Promise<{ ok: false; error: string }> {
  return { ok: false, error: (await serverT("serverErrors.bank"))(reason) };
}

async function guard() {
  const actor = await requireCapability("bank:reconcile");
  await requirePlanModule("sales");
  return actor;
}

function announcePaid(settled: Settled[], actor: string) {
  for (const s of settled) {
    dispatchWebhook("invoice.paid", { id: s.invoiceId, paid: s.paid, due: s.due }, { via: "user", actor }).catch(
      (err) => console.error("[bank] invoice.paid not dispatched", err),
    );
  }
}

function refresh(input: { invoiceIds?: string[]; companyIds?: (string | null)[] } = {}) {
  revalidatePath("/dashboard/sales/bank");
  revalidatePath("/dashboard/sales/finance");
  for (const id of new Set(input.invoiceIds ?? [])) revalidatePath(`/dashboard/sales/invoices/${id}`);
  for (const id of new Set(input.companyIds ?? [])) if (id) revalidatePath(`/dashboard/companies/${id}`);
}

/** The accounts, and for the chosen one: the queue, and what was reconciled or ignored lately. */
export async function getBankOverview(accountId: string | null) {
  await guard();
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  return tolerateUnmigrated(
    "bank reconciliation",
    async () => {
      const accounts = await listAccounts(db);
      const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
      if (!account) return { accounts, account: null, queue: null, reconciled: [], ignored: [], today: "" };
      const today = toWallDate(new Date(), timeZone);
      const [queue, reconciled, ignored] = await Promise.all([
        bankQueue(db, { accountId: account.id, today, timeZone }),
        doneLines(db, { accountId: account.id, state: "reconciled", limit: 50 }),
        doneLines(db, { accountId: account.id, state: "ignored", limit: 50 }),
      ]);
      return { accounts, account, queue, reconciled, ignored, today };
    },
    null,
  );
}

/** A customer's open invoices and credit, for choosing by hand where a line goes. */
export async function getCompanyOpenItems(companyId: string) {
  await guard();
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const [owed, credit] = await Promise.all([
    receivables(db, { today: toWallDate(new Date(), timeZone), companyId }),
    customerCredit(db, companyId),
  ]);
  return {
    invoices: owed.invoices.map((i) => ({
      id: i.id,
      number: i.documentNumber,
      dueDate: i.dueDate,
      currency: i.currency,
      outstanding: i.outstanding,
    })),
    credit,
  };
}

export async function createBankAccountAction(input: {
  name: string;
  iban?: string;
  currency?: string;
}): Promise<Outcome<{ id: string }>> {
  const actor = await guard();
  const r = await createAccount(await getDb(), { ...input, by: actor.userId });
  if (!r.ok) return refusal(r.reason);
  refresh();
  return { ok: true, id: r.id };
}

export async function updateBankAccountAction(id: string, input: { name: string; iban?: string }): Promise<Outcome> {
  await guard();
  const r = await updateAccount(await getDb(), { id, ...input });
  if (!r.ok) return refusal(r.reason);
  refresh();
  return { ok: true };
}

export async function archiveBankAccountAction(id: string): Promise<Outcome> {
  await guard();
  if (!(await archiveAccount(await getDb(), id))) return refusal("not_found");
  refresh();
  return { ok: true };
}

export async function saveBankMappingAction(accountId: string, mapping: unknown): Promise<Outcome> {
  await guard();
  if (!(await saveCsvMapping(await getDb(), accountId, mapping))) return refusal("mapping");
  return { ok: true };
}

/** One chunk of a statement read in the browser. The first chunk opens the import; the rest name it. */
export async function importBankChunkAction(
  accountId: string,
  movements: unknown[],
  meta: { fileName?: string; format: "camt" | "csv"; importId?: string | null },
): Promise<Outcome<{ importId: string; created: number; skipped: number; rejected: number }>> {
  const actor = await guard();
  if (!Array.isArray(movements) || (meta.format !== "camt" && meta.format !== "csv")) return refusal("mapping");
  const r = await importMovements(await getDb(), {
    accountId,
    movements,
    fileName: meta.fileName,
    format: meta.format,
    importId: meta.importId,
    by: actor.userId,
  });
  if (!r.ok) return refusal(r.reason);
  refresh();
  return { ok: true, importId: r.importId, created: r.created, skipped: r.skipped, rejected: r.rejected.length };
}

/** A line explained as the person chose: receipts linked, or a new receipt allocated. */
export async function confirmBankLineAction(
  transactionId: string,
  choice: {
    receiptIds?: string[];
    companyId?: string | null;
    allocations?: { invoiceId?: string; orderId?: string; amount: number | string }[];
  },
): Promise<Outcome> {
  const actor = await guard();
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const r = await confirmLine(db, {
    transactionId,
    receiptIds: Array.isArray(choice.receiptIds) ? choice.receiptIds.filter((x) => typeof x === "string") : [],
    companyId: typeof choice.companyId === "string" ? choice.companyId : null,
    allocations: Array.isArray(choice.allocations)
      ? choice.allocations.filter((a) => Number(String(a.amount).replace(",", ".")) > 0)
      : [],
    timeZone,
    by: actor.userId,
  });
  if (!r.ok) return refusal(r.reason);
  announcePaid(r.settled, actor.userId);
  refresh({ invoiceIds: r.invoiceIds, companyIds: [r.companyId] });
  return { ok: true };
}

/** The proposals the person saw as sure, confirmed while they still are. */
export async function confirmSureAction(
  accountId: string,
  picks: { transactionId: string; key: string }[],
): Promise<Outcome<{ confirmed: number; changed: number; failed: number }>> {
  const actor = await guard();
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const r = await confirmSure(db, {
    accountId,
    picks: Array.isArray(picks)
      ? picks.filter((p) => typeof p?.transactionId === "string" && typeof p?.key === "string")
      : [],
    today: toWallDate(new Date(), timeZone),
    timeZone,
    by: actor.userId,
  });
  announcePaid(r.settled, actor.userId);
  refresh({ invoiceIds: r.invoiceIds, companyIds: r.companyIds });
  return { ok: true, confirmed: r.confirmed, changed: r.changed, failed: r.failed };
}

export async function ignoreBankLinesAction(accountId: string, ids: string[]): Promise<Outcome<{ ignored: number }>> {
  const actor = await guard();
  const ignored = await ignoreLines(await getDb(), {
    accountId,
    ids: Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [],
    by: actor.userId,
  });
  refresh();
  return { ok: true, ignored };
}

export async function restoreBankLineAction(id: string): Promise<Outcome> {
  await guard();
  if (!(await restoreLine(await getDb(), id))) return refusal("not_found");
  refresh();
  return { ok: true };
}

/** Takes a reconciliation back: a receipt the bank wrote goes, one typed by hand is only unlinked. */
export async function undoBankLineAction(id: string): Promise<Outcome> {
  await guard();
  const r = await undoLine(await getDb(), id);
  if (!r.ok) return refusal("not_found");
  refresh({ invoiceIds: r.invoiceIds, companyIds: r.companyIds });
  return { ok: true };
}

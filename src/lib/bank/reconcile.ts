/**
 * Bank reconciliation, against the database (I13, migration 0061).
 *
 * A statement is imported as lines (`bank_transaction`), each kept once under its fingerprint.
 * A line is **reconciled** when receipts name it: a receipt a confirmation writes, with its
 * allocations, or receipts somebody typed by hand before the statement arrived, linked. It is
 * **ignored** when nobody needs to explain it — bank charges, a supplier paid. Nothing else
 * marks it: the receipts are the fact, and a flag beside them would drift the first time one
 * was deleted.
 *
 * ⚠️⚠️ **The database decides that a line is explained once.** Every write that names a line
 * takes its row lock and ends with `guardBankTransaction`, which fails the transaction when the
 * receipts naming it would exceed it, go the other way, or explain a line that was ignored. Two
 * people confirming the same line — or bulk confirmation racing a person — write one receipt.
 *
 * ⚠️ Nothing is confirmed automatically. `sure` proposals are confirmed in bulk by a person, and
 * only while they still say what that person saw (`key`).
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  bankAccounts,
  bankImports,
  bankTransactions,
  companies,
  companyIbans,
  invoices,
  orderPayments,
  orders,
  receipts,
} from "@/db/schema";
import { chunk, INSERT_CHUNK } from "@/lib/api-import-batch";
import { paymentDay } from "@/lib/order-payment";
import {
  type AllocationInput,
  guardBankTransaction,
  isOverAllocation,
  lockBankTransaction,
  type ReceiptRefusal,
  recordReceipt,
  type Settled,
} from "@/lib/receipts";
import { balanceOf, receivables } from "@/lib/receivables";
import { toWallDate } from "@/lib/wall-clock";

import type { CsvMapping } from "./csv";
import { type MatchContext, markContested, type Proposal, proposeMatches } from "./match";
import { cleanMovement, fingerprintOf, type MovementProblem, normalizeIban, sha256Hex } from "./movement";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

const cents = (n: number) => Math.round(n * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lines per import request: the page sends a file in chunks of this many. */
export const IMPORT_MAX = 500;
/** Lines per bulk confirmation request: each is a handful of statements. */
export const BULK_MAX = 50;
/** Lines the queue shows at once, newest first. */
const QUEUE_LIMIT = 300;
/** How far back a hand-typed receipt is looked for, in days. */
const LOOSE_RECEIPT_DAYS = 90;

// ─── Accounts ────────────────────────────────────────────────────────────────

export type AccountRefusal = "name" | "iban" | "currency" | "not_found";

export interface BankAccountRow {
  id: string;
  name: string;
  iban: string | null;
  currency: string;
  csvMapping: unknown;
}

export async function listAccounts(db: AnyDb): Promise<BankAccountRow[]> {
  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      iban: bankAccounts.iban,
      currency: bankAccounts.currency,
      csvMapping: bankAccounts.csvMapping,
    })
    .from(bankAccounts)
    .where(isNull(bankAccounts.archivedAt))
    .orderBy(bankAccounts.createdAt);
}

function cleanAccount(input: { name?: unknown; iban?: unknown; currency?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) return { ok: false as const, reason: "name" as const };
  const rawIban = typeof input.iban === "string" ? input.iban.trim() : "";
  const iban = rawIban ? normalizeIban(rawIban) : null;
  if (rawIban && !iban) return { ok: false as const, reason: "iban" as const };
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "EUR";
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false as const, reason: "currency" as const };
  return { ok: true as const, name, iban, currency };
}

export async function createAccount(
  db: AnyDb,
  input: { name: unknown; iban?: unknown; currency?: unknown; by: string | null },
): Promise<{ ok: true; id: string } | { ok: false; reason: AccountRefusal }> {
  const clean = cleanAccount(input);
  if (!clean.ok) return clean;
  const id = crypto.randomUUID();
  await db
    .insert(bankAccounts)
    .values({ id, name: clean.name, iban: clean.iban, currency: clean.currency, createdById: input.by });
  return { ok: true, id };
}

/** Renames an account or corrects its IBAN. The currency is fixed once lines are in it. */
export async function updateAccount(
  db: AnyDb,
  input: { id: string; name: unknown; iban?: unknown },
): Promise<{ ok: true } | { ok: false; reason: AccountRefusal }> {
  const clean = cleanAccount({ ...input, currency: "EUR" });
  if (!clean.ok) return clean;
  const updated = await db
    .update(bankAccounts)
    .set({ name: clean.name, iban: clean.iban })
    .where(and(eq(bankAccounts.id, input.id), isNull(bankAccounts.archivedAt)))
    .returning({ id: bankAccounts.id });
  return updated.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/** Takes an account off the screens. Its lines and the receipts they explain stay. */
export async function archiveAccount(db: AnyDb, id: string): Promise<boolean> {
  const updated = await db
    .update(bankAccounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(bankAccounts.id, id), isNull(bankAccounts.archivedAt)))
    .returning({ id: bankAccounts.id });
  return updated.length > 0;
}

const MAPPING_TEXT = [
  "date",
  "valueDate",
  "amount",
  "credit",
  "debit",
  "counterparty",
  "iban",
  "reference",
  "currency",
];

/** A CSV mapping as it is stored: header names only, nothing else. Null when it is not one. */
export function cleanMapping(input: unknown): CsvMapping | null {
  const m = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  if (!str(m.date)) return null;
  if (!str(m.amount) && !(str(m.credit) && str(m.debit))) return null;
  if (!["dmy", "ymd", "mdy"].includes(String(m.dateOrder)) || ![",", "."].includes(String(m.decimal))) return null;
  const out: Record<string, unknown> = {};
  for (const k of MAPPING_TEXT) out[k] = str(m[k]);
  out.description = Array.isArray(m.description) ? m.description.map(str).filter(Boolean).slice(0, 6) : [];
  out.dateOrder = m.dateOrder;
  out.decimal = m.decimal;
  return out as unknown as CsvMapping;
}

export async function saveCsvMapping(db: AnyDb, accountId: string, mapping: unknown): Promise<boolean> {
  const clean = cleanMapping(mapping);
  if (!clean) return false;
  const updated = await db
    .update(bankAccounts)
    .set({ csvMapping: clean })
    .where(eq(bankAccounts.id, accountId))
    .returning({ id: bankAccounts.id });
  return updated.length > 0;
}

// ─── Import ──────────────────────────────────────────────────────────────────

export interface ImportResult {
  ok: true;
  importId: string;
  created: number;
  /** Already in: the same line from an earlier import. */
  skipped: number;
  rejected: { index: number; problem: MovementProblem | "other_currency" }[];
}

/**
 * Keeps a chunk of a statement. Three passes, like the import API: check every line with no
 * database, then write in chunks, each insert skipping what is already there — the unique
 * fingerprint decides, so two imports of the same file at once add each line once.
 */
export async function importMovements(
  db: AnyDb,
  input: {
    accountId: string;
    movements: unknown[];
    fileName?: string | null;
    format: "camt" | "csv";
    importId?: string | null;
    by: string | null;
  },
): Promise<ImportResult | { ok: false; reason: "not_found" | "too_many" }> {
  if (input.movements.length > IMPORT_MAX) return { ok: false, reason: "too_many" };
  const [account] = await db
    .select({ id: bankAccounts.id, currency: bankAccounts.currency })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.accountId), isNull(bankAccounts.archivedAt)));
  if (!account) return { ok: false, reason: "not_found" };

  const rejected: ImportResult["rejected"] = [];
  const rows: (typeof bankTransactions.$inferInsert)[] = [];
  for (const [index, raw] of input.movements.entries()) {
    const clean = cleanMovement(raw);
    if (!clean.ok) {
      rejected.push({ index, problem: clean.problem });
      continue;
    }
    const m = clean.movement;
    if (m.currency !== account.currency) {
      rejected.push({ index, problem: "other_currency" });
      continue;
    }
    rows.push({
      id: crypto.randomUUID(),
      accountId: account.id,
      bookedOn: m.bookedOn,
      valueOn: m.valueOn ?? null,
      amount: String(m.amount),
      currency: m.currency,
      counterpartyName: m.counterpartyName ?? null,
      counterpartyIban: m.counterpartyIban ?? null,
      remittance: m.remittance ?? null,
      bankReference: m.bankReference ?? null,
      fingerprint: await sha256Hex(fingerprintOf(m)),
    });
  }

  // One import row per file: the page sends the first chunk without an id and the rest with it.
  let importId = input.importId ?? null;
  if (importId) {
    const [known] = await db
      .select({ id: bankImports.id })
      .from(bankImports)
      .where(and(eq(bankImports.id, importId), eq(bankImports.accountId, account.id)));
    if (!known) importId = null;
  }
  if (!importId) {
    importId = crypto.randomUUID();
    await db.insert(bankImports).values({
      id: importId,
      accountId: account.id,
      fileName: typeof input.fileName === "string" ? input.fileName.slice(0, 200) : null,
      format: input.format,
      createdById: input.by,
    });
  }

  let created = 0;
  for (const part of chunk(rows, INSERT_CHUNK)) {
    const inserted = await db
      .insert(bankTransactions)
      .values(part.map((r) => ({ ...r, importId })))
      .onConflictDoNothing()
      .returning({ id: bankTransactions.id });
    created += inserted.length;
  }
  const skipped = rows.length - created;
  await db
    .update(bankImports)
    .set({
      created: sql`${bankImports.created} + ${created}`,
      skipped: sql`${bankImports.skipped} + ${skipped}`,
    })
    .where(eq(bankImports.id, importId));
  return { ok: true, importId, created, skipped, rejected };
}

// ─── The queue ───────────────────────────────────────────────────────────────

export interface Line {
  id: string;
  bookedOn: string;
  valueOn: string | null;
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittance: string | null;
  bankReference: string | null;
  /** What receipts already explain of it. */
  linked: number;
}

export interface QueueLine extends Line {
  proposals: Proposal[];
}

export interface DoneLine extends Line {
  ignoredAt: Date | null;
  receipts: {
    id: string;
    amount: number;
    source: string;
    companyId: string | null;
    companyName: string | null;
    invoices: { id: string; number: string | null }[];
    orders: { id: string; number: string | null }[];
  }[];
}

const linkedSql = sql<string>`coalesce((select sum(r.amount) from receipt r where r.bank_transaction_id = "bank_transaction"."id"), 0)`;
const lineColumns = {
  id: bankTransactions.id,
  accountId: bankTransactions.accountId,
  bookedOn: bankTransactions.bookedOn,
  valueOn: bankTransactions.valueOn,
  amount: bankTransactions.amount,
  currency: bankTransactions.currency,
  counterpartyName: bankTransactions.counterpartyName,
  counterpartyIban: bankTransactions.counterpartyIban,
  remittance: bankTransactions.remittance,
  bankReference: bankTransactions.bankReference,
  ignoredAt: bankTransactions.ignoredAt,
  linked: linkedSql,
};
type LineRow = {
  [K in keyof typeof lineColumns]: K extends "amount" | "linked"
    ? string
    : K extends "ignoredAt"
      ? Date | null
      : string;
};
const toLine = (r: LineRow): Line => ({
  id: r.id,
  bookedOn: r.bookedOn,
  valueOn: r.valueOn ?? null,
  amount: Number(r.amount),
  currency: r.currency,
  counterpartyName: r.counterpartyName ?? null,
  counterpartyIban: r.counterpartyIban ?? null,
  remittance: r.remittance ?? null,
  bankReference: r.bankReference ?? null,
  linked: round2(Number(r.linked)),
});

// Whether a line still has something to explain: not ignored, receipts short of its amount.
const openSql = sql`${bankTransactions.ignoredAt} is null and abs(${linkedSql}) < abs(${bankTransactions.amount})`;

/** Everything a line can be matched against, loaded once for the whole queue. */
export async function matchContext(
  db: AnyDb,
  input: { today: string; timeZone: string; ibans: string[] },
): Promise<MatchContext> {
  const since = new Date(Date.parse(`${input.today}T00:00:00Z`) - LOOSE_RECEIPT_DAYS * 86_400_000);
  const [owed, openOrders, loose, ibanRows, companyRows] = await Promise.all([
    receivables(db, { today: input.today }),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        companyId: orders.companyId,
        currency: orders.currency,
        outstanding: sql<string>`${orders.totalAmount} - coalesce((select sum(p.amount) from order_payment p where p.order_id = "order"."id"), 0)`,
      })
      .from(orders)
      .where(
        and(
          sql`${orders.status} <> 'cancelled'`,
          // An order invoiced is paid through its invoices, which the queue already offers.
          sql`not exists (select 1 from invoice i where i.order_id = "order"."id" and i.status = 'issued' and i.document_type = 'TD01')`,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(2000),
    db
      .select({
        id: receipts.id,
        companyId: receipts.companyId,
        amount: receipts.amount,
        currency: receipts.currency,
        receivedAt: receipts.receivedAt,
      })
      .from(receipts)
      .where(and(isNull(receipts.bankTransactionId), sql`${receipts.receivedAt} >= ${since}`))
      .limit(2000),
    input.ibans.length > 0
      ? db
          .select({ iban: companyIbans.iban, companyId: companyIbans.companyId })
          .from(companyIbans)
          .where(inArray(companyIbans.iban, input.ibans))
      : [],
    db.select({ id: companies.id, name: companies.name }).from(companies).limit(10_000),
  ]);
  const ibans = new Map<string, string[]>();
  for (const r of ibanRows as { iban: string; companyId: string }[])
    ibans.set(r.iban, [...(ibans.get(r.iban) ?? []), r.companyId]);
  return {
    invoices: owed.invoices.map((i) => ({
      id: i.id,
      documentNumber: i.documentNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      companyId: i.companyId,
      currency: i.currency,
      outstanding: i.outstanding,
      nextInstallment: i.installments?.find((x) => x.outstanding > 0)?.outstanding ?? null,
    })),
    orders: (
      openOrders as {
        id: string;
        orderNumber: string;
        companyId: string | null;
        currency: string;
        outstanding: string;
      }[]
    )
      .map((o) => ({ ...o, outstanding: round2(Number(o.outstanding)) }))
      .filter((o) => o.outstanding > 0),
    receipts: (
      loose as { id: string; companyId: string | null; amount: string; currency: string; receivedAt: Date }[]
    ).map((r) => ({
      id: r.id,
      companyId: r.companyId,
      amount: Number(r.amount),
      currency: r.currency,
      receivedOn: toWallDate(r.receivedAt, input.timeZone),
    })),
    ibans,
    companies: companyRows,
  };
}

export interface Queue {
  /** Money in still to explain, each with its proposals. */
  open: QueueLine[];
  /** Money out still unexplained: ignored, or a refund already written down. */
  outgoing: QueueLine[];
  counts: { open: number; outgoing: number; reconciled: number; ignored: number };
  /** What the proposals name, for the screen: customers, invoices, orders, receipts. */
  labels: QueueLabels;
}

export interface QueueLabels {
  companies: Record<string, string>;
  invoices: Record<string, { number: string | null; outstanding: number; dueDate: string; companyId: string | null }>;
  orders: Record<string, { number: string }>;
  receipts: Record<string, { receivedOn: string; amount: number; companyId: string | null }>;
}

/** Only what some proposal names: the context holds every open document in the workspace. */
function labelsFor(lines: readonly QueueLine[], ctx: MatchContext): QueueLabels {
  const labels: QueueLabels = { companies: {}, invoices: {}, orders: {}, receipts: {} };
  const companyIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const orderIds = new Set<string>();
  const receiptIds = new Set<string>();
  for (const l of lines)
    for (const p of l.proposals) {
      if (p.companyId) companyIds.add(p.companyId);
      for (const a of p.allocations) {
        if (a.invoiceId) invoiceIds.add(a.invoiceId);
        if (a.orderId) orderIds.add(a.orderId);
      }
      for (const r of p.receiptIds) receiptIds.add(r);
    }
  for (const i of ctx.invoices)
    if (invoiceIds.has(i.id)) {
      labels.invoices[i.id] = {
        number: i.documentNumber,
        outstanding: i.outstanding,
        dueDate: i.dueDate,
        companyId: i.companyId,
      };
      if (i.companyId) companyIds.add(i.companyId);
    }
  for (const o of ctx.orders) if (orderIds.has(o.id)) labels.orders[o.id] = { number: o.orderNumber };
  for (const r of ctx.receipts)
    if (receiptIds.has(r.id))
      labels.receipts[r.id] = { receivedOn: r.receivedOn, amount: r.amount, companyId: r.companyId };
  for (const c of ctx.companies) if (companyIds.has(c.id)) labels.companies[c.id] = c.name;
  return labels;
}

export async function bankQueue(
  db: AnyDb,
  input: { accountId: string; today: string; timeZone: string },
): Promise<Queue> {
  const [rows, [counts]] = await Promise.all([
    db
      .select(lineColumns)
      .from(bankTransactions)
      .where(and(eq(bankTransactions.accountId, input.accountId), openSql))
      .orderBy(desc(bankTransactions.bookedOn), desc(bankTransactions.createdAt))
      .limit(QUEUE_LIMIT) as Promise<LineRow[]>,
    db
      .select({
        open: sql<number>`count(*) filter (where ${openSql} and ${bankTransactions.amount} > 0)::int`,
        outgoing: sql<number>`count(*) filter (where ${openSql} and ${bankTransactions.amount} < 0)::int`,
        reconciled: sql<number>`count(*) filter (where ${bankTransactions.ignoredAt} is null and abs(${linkedSql}) >= abs(${bankTransactions.amount}))::int`,
        ignored: sql<number>`count(*) filter (where ${bankTransactions.ignoredAt} is not null)::int`,
      })
      .from(bankTransactions)
      .where(eq(bankTransactions.accountId, input.accountId)),
  ]);
  const lines = rows.map(toLine);
  const ctx = await matchContext(db, {
    today: input.today,
    timeZone: input.timeZone,
    ibans: [...new Set(lines.flatMap((l) => (l.counterpartyIban ? [l.counterpartyIban] : [])))],
  });
  const withProposals: QueueLine[] = lines.map((l) => ({
    ...l,
    proposals: proposeMatches(
      {
        amount: round2(l.amount - l.linked),
        currency: l.currency,
        bookedOn: l.bookedOn,
        counterpartyName: l.counterpartyName,
        counterpartyIban: l.counterpartyIban,
        remittance: l.remittance,
      },
      ctx,
    ),
  }));
  const open = withProposals.filter((l) => l.amount > 0);
  markContested(open);
  return {
    open,
    outgoing: withProposals.filter((l) => l.amount < 0),
    counts: counts ?? { open: 0, outgoing: 0, reconciled: 0, ignored: 0 },
    labels: labelsFor(withProposals, ctx),
  };
}

/** Lines already dealt with — reconciled or ignored — newest first, with what explains them. */
export async function doneLines(
  db: AnyDb,
  input: { accountId: string; state: "reconciled" | "ignored"; limit?: number },
): Promise<DoneLine[]> {
  const rows: LineRow[] = await db
    .select(lineColumns)
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.accountId, input.accountId),
        input.state === "ignored"
          ? isNotNull(bankTransactions.ignoredAt)
          : sql`${bankTransactions.ignoredAt} is null and abs(${linkedSql}) >= abs(${bankTransactions.amount})`,
      ),
    )
    .orderBy(desc(bankTransactions.bookedOn), desc(bankTransactions.createdAt))
    .limit(input.limit ?? 100);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const linked: {
    id: string;
    transactionId: string;
    amount: string;
    source: string;
    companyId: string | null;
    companyName: string | null;
  }[] =
    input.state === "reconciled"
      ? await db
          .select({
            id: receipts.id,
            transactionId: receipts.bankTransactionId,
            amount: receipts.amount,
            source: receipts.source,
            companyId: receipts.companyId,
            companyName: companies.name,
          })
          .from(receipts)
          .leftJoin(companies, eq(companies.id, receipts.companyId))
          .where(inArray(receipts.bankTransactionId, ids))
      : [];
  // What each receipt paid: invoices, and orders paid on account (a deposit not invoiced yet).
  const paid: {
    receiptId: string;
    invoiceId: string | null;
    invoiceNumber: string | null;
    orderId: string | null;
    orderNumber: string | null;
  }[] =
    linked.length > 0
      ? await db
          .select({
            receiptId: orderPayments.receiptId,
            invoiceId: orderPayments.invoiceId,
            invoiceNumber: invoices.documentNumber,
            orderId: orderPayments.orderId,
            orderNumber: orders.orderNumber,
          })
          .from(orderPayments)
          .leftJoin(invoices, eq(invoices.id, orderPayments.invoiceId))
          .leftJoin(orders, eq(orders.id, orderPayments.orderId))
          .where(
            inArray(
              orderPayments.receiptId,
              linked.map((r) => r.id),
            ),
          )
      : [];
  return rows.map((r) => ({
    ...toLine(r),
    ignoredAt: r.ignoredAt,
    receipts: linked
      .filter((x) => x.transactionId === r.id)
      .map((x) => ({
        id: x.id,
        amount: Number(x.amount),
        source: x.source,
        companyId: x.companyId,
        companyName: x.companyName,
        invoices: paid
          .filter((p) => p.receiptId === x.id && p.invoiceId)
          .map((p) => ({ id: p.invoiceId as string, number: p.invoiceNumber })),
        orders: paid
          .filter((p) => p.receiptId === x.id && !p.invoiceId && p.orderId)
          .map((p) => ({ id: p.orderId as string, number: p.orderNumber })),
      })),
  }));
}

// ─── Confirming, ignoring, undoing ───────────────────────────────────────────

export type ConfirmRefusal = ReceiptRefusal | "mixed" | "no_customer" | "overpays" | "outgoing" | "invalid_date";

async function lineFor(db: AnyDb, id: string) {
  const [row]: LineRow[] = await db.select(lineColumns).from(bankTransactions).where(eq(bankTransactions.id, id));
  return row ? { ...toLine(row), ignoredAt: row.ignoredAt, accountId: row.accountId } : null;
}

/** Records that this IBAN paid for this customer — or, undone, that it did once less. */
async function learnIban(db: AnyDb, iban: string | null, companyIds: (string | null)[], step: 1 | -1) {
  const ids = [...new Set(companyIds.filter((c): c is string => Boolean(c)))];
  if (!iban || ids.length === 0) return;
  if (step === 1) {
    await db
      .insert(companyIbans)
      .values(ids.map((companyId) => ({ iban, companyId })))
      .onConflictDoUpdate({
        target: [companyIbans.iban, companyIbans.companyId],
        set: { seen: sql`${companyIbans.seen} + 1`, lastSeenAt: new Date() },
      });
    return;
  }
  await db
    .update(companyIbans)
    .set({ seen: sql`${companyIbans.seen} - 1` })
    .where(and(eq(companyIbans.iban, iban), inArray(companyIbans.companyId, ids)));
  await db.delete(companyIbans).where(and(eq(companyIbans.iban, iban), sql`${companyIbans.seen} <= 0`));
}

export interface ConfirmInput {
  transactionId: string;
  /** Receipts typed by hand that this line is: linked, nothing new written. */
  receiptIds?: string[];
  /** Or a new receipt for what is left of the line, allocated like this; the rest is credit. */
  companyId?: string | null;
  allocations?: AllocationInput[];
  timeZone: string;
  by: string | null;
}

export type ConfirmResult =
  | { ok: true; receiptIds: string[]; companyId: string | null; invoiceIds: string[]; settled: Settled[] }
  | { ok: false; reason: ConfirmRefusal };

/**
 * Explains a line: links receipts already written down, or writes one receipt for what is left
 * of it with its allocations. Either way under the line's lock, and refused by the database
 * when somebody else explained it first.
 */
export async function confirmLine(db: AnyDb, input: ConfirmInput): Promise<ConfirmResult> {
  const line = await lineFor(db, input.transactionId);
  if (!line) return { ok: false, reason: "not_found" };
  if (line.ignoredAt) return { ok: false, reason: "already_reconciled" };
  const left = round2(line.amount - line.linked);
  if (cents(left) === 0) return { ok: false, reason: "already_reconciled" };
  const receiptIds = [...new Set(input.receiptIds ?? [])];
  const allocations = input.allocations ?? [];
  if (receiptIds.length > 0 && allocations.length > 0) return { ok: false, reason: "mixed" };

  if (receiptIds.length > 0) {
    const found: { id: string; amount: string; currency: string; companyId: string | null; line: string | null }[] =
      await db
        .select({
          id: receipts.id,
          amount: receipts.amount,
          currency: receipts.currency,
          companyId: receipts.companyId,
          line: receipts.bankTransactionId,
        })
        .from(receipts)
        .where(inArray(receipts.id, receiptIds));
    if (found.length !== receiptIds.length) return { ok: false, reason: "not_found" };
    if (found.some((r) => r.line)) return { ok: false, reason: "already_reconciled" };
    if (found.some((r) => r.currency !== line.currency)) return { ok: false, reason: "mixed_currency" };
    const ids = JSON.stringify(receiptIds);
    try {
      await together(db, (h) => [
        lockBankTransaction(h, line.id),
        h
          .update(receipts)
          .set({ bankTransactionId: line.id, accountId: line.accountId })
          .where(and(inArray(receipts.id, receiptIds), isNull(receipts.bankTransactionId))),
        // Every receipt asked for is now this line's, or none is: one taken meanwhile by another
        // line fails the whole link rather than leaving it half made.
        h
          .select({
            ok: sql<number>`1 / (case when (select count(*) from receipt r where r.bank_transaction_id = ${line.id}
              and r.id in (select jsonb_array_elements_text(${ids}::jsonb))) = ${receiptIds.length} then 1 else 0 end)`,
          })
          .from(bankTransactions)
          .where(eq(bankTransactions.id, line.id)),
        guardBankTransaction(h, line.id),
      ]);
    } catch (error) {
      if (isOverAllocation(error)) return { ok: false, reason: "already_reconciled" };
      throw error;
    }
    await learnIban(
      db,
      line.counterpartyIban,
      found.map((r) => r.companyId),
      1,
    );
    return { ok: true, receiptIds, companyId: found[0]?.companyId ?? null, invoiceIds: [], settled: [] };
  }

  // A new receipt: money in only — money out is a refund, written from the invoice or the customer.
  if (left < 0) return { ok: false, reason: "outgoing" };
  const allocated = allocations.reduce((s, a) => s + cents(Number(a.amount)), 0);
  if (allocated > cents(left)) return { ok: false, reason: "over_allocated" };
  if (allocated < cents(left) && !input.companyId) return { ok: false, reason: "no_customer" };
  // ⚠️ The bank never pays an invoice beyond what it owes: the rest belongs in credit, where a
  // person can see it. Typed by hand, an overpayment is somebody's decision; proposed, a mistake.
  for (const a of allocations) {
    if (!a.invoiceId) continue;
    const balance = await balanceOf(db, a.invoiceId);
    if (!balance) return { ok: false, reason: "not_found" };
    if (cents(Number(a.amount)) > cents(balance.outstanding)) return { ok: false, reason: "overpays" };
  }
  const receivedAt = paymentDay(line.bookedOn, input.timeZone);
  if (!receivedAt) return { ok: false, reason: "invalid_date" };
  const result = await recordReceipt(db, {
    companyId: input.companyId ?? null,
    amount: left,
    receivedAt,
    currency: line.currency,
    reference: line.bankReference,
    note: line.remittance,
    accountId: line.accountId,
    source: "bank",
    bankTransactionId: line.id,
    by: input.by,
    allocations,
  });
  if (!result.ok) return result;
  const [receipt] = await db
    .select({ companyId: receipts.companyId })
    .from(receipts)
    .where(eq(receipts.id, result.receiptId));
  await learnIban(db, line.counterpartyIban, [receipt?.companyId ?? null], 1);
  return {
    ok: true,
    receiptIds: [result.receiptId],
    companyId: receipt?.companyId ?? null,
    invoiceIds: allocations.flatMap((a) => (a.invoiceId ? [a.invoiceId] : [])),
    settled: result.settled,
  };
}

/** Statements that must land together: a batch on the HTTP driver, a transaction elsewhere. */
async function together(db: AnyDb, statements: (h: AnyDb) => unknown[]): Promise<unknown[]> {
  if (typeof db.batch === "function") return db.batch(statements(db));
  return db.transaction(async (tx: AnyDb) => {
    const out: unknown[] = [];
    for (const statement of statements(tx)) out.push(await statement);
    return out;
  });
}

/**
 * Confirms the `sure` proposals a person saw, and only while each is still the best and still
 * sure: the queue is worked out again here, and a line whose proposal changed meanwhile — a
 * payment typed, another line confirmed — is left for them to look at.
 */
export async function confirmSure(
  db: AnyDb,
  input: {
    accountId: string;
    picks: { transactionId: string; key: string }[];
    today: string;
    timeZone: string;
    by: string | null;
  },
): Promise<{
  confirmed: number;
  changed: number;
  failed: number;
  settled: Settled[];
  invoiceIds: string[];
  companyIds: string[];
}> {
  const picks = input.picks.slice(0, BULK_MAX);
  const queue = await bankQueue(db, { accountId: input.accountId, today: input.today, timeZone: input.timeZone });
  const best = new Map(queue.open.map((l) => [l.id, l.proposals[0]]));
  const out = {
    confirmed: 0,
    changed: 0,
    failed: 0,
    settled: [] as Settled[],
    invoiceIds: [] as string[],
    companyIds: [] as string[],
  };
  for (const pick of picks) {
    const p = best.get(pick.transactionId);
    if (!p || p.key !== pick.key || p.confidence !== "sure") {
      out.changed++;
      continue;
    }
    const r = await confirmLine(db, {
      transactionId: pick.transactionId,
      receiptIds: p.receiptIds,
      companyId: p.companyId,
      allocations: p.allocations,
      timeZone: input.timeZone,
      by: input.by,
    });
    if (!r.ok) {
      out.failed++;
      continue;
    }
    out.confirmed++;
    out.settled.push(...r.settled);
    out.invoiceIds.push(...r.invoiceIds);
    if (r.companyId) out.companyIds.push(r.companyId);
  }
  return out;
}

/** Marks lines as needing no explanation. Only lines no receipt names yet. */
export async function ignoreLines(
  db: AnyDb,
  input: { accountId: string; ids: string[]; by: string | null },
): Promise<number> {
  if (input.ids.length === 0) return 0;
  const updated = await db
    .update(bankTransactions)
    .set({ ignoredAt: new Date(), ignoredById: input.by })
    .where(
      and(
        eq(bankTransactions.accountId, input.accountId),
        inArray(bankTransactions.id, input.ids.slice(0, IMPORT_MAX)),
        isNull(bankTransactions.ignoredAt),
        sql`not exists (select 1 from receipt r where r.bank_transaction_id = "bank_transaction"."id")`,
      ),
    )
    .returning({ id: bankTransactions.id });
  return updated.length;
}

/** Puts an ignored line back in the queue. */
export async function restoreLine(db: AnyDb, id: string): Promise<boolean> {
  const updated = await db
    .update(bankTransactions)
    .set({ ignoredAt: null, ignoredById: null })
    .where(and(eq(bankTransactions.id, id), isNotNull(bankTransactions.ignoredAt)))
    .returning({ id: bankTransactions.id });
  return updated.length > 0;
}

/**
 * Takes a reconciliation back. A receipt the confirmation wrote goes, with its allocations —
 * that money is back to unexplained; a receipt typed by hand stays, only unlinked, because it
 * was somebody's record before the statement came.
 */
export async function undoLine(
  db: AnyDb,
  id: string,
): Promise<{ ok: boolean; invoiceIds: string[]; companyIds: string[] }> {
  const line = await lineFor(db, id);
  if (!line) return { ok: false, invoiceIds: [], companyIds: [] };
  const linked: { id: string; source: string; companyId: string | null }[] = await db
    .select({ id: receipts.id, source: receipts.source, companyId: receipts.companyId })
    .from(receipts)
    .where(eq(receipts.bankTransactionId, id));
  if (linked.length === 0) return { ok: false, invoiceIds: [], companyIds: [] };
  const paid: { invoiceId: string | null }[] = await db
    .select({ invoiceId: orderPayments.invoiceId })
    .from(orderPayments)
    .where(
      inArray(
        orderPayments.receiptId,
        linked.map((r) => r.id),
      ),
    );
  await together(db, (h) => [
    h.delete(receipts).where(and(eq(receipts.bankTransactionId, id), eq(receipts.source, "bank"))),
    h.update(receipts).set({ bankTransactionId: null, accountId: null }).where(eq(receipts.bankTransactionId, id)),
  ]);
  const companyIds = [...new Set(linked.flatMap((r) => (r.companyId ? [r.companyId] : [])))];
  await learnIban(db, line.counterpartyIban, companyIds, -1);
  return { ok: true, invoiceIds: paid.flatMap((p) => (p.invoiceId ? [p.invoiceId] : [])), companyIds };
}

/**
 * A customer's statement of account (I14): every document and every movement of money between
 * us and them, in date order, with the balance after each — what an accountant asks for and what
 * a customer disputing a reminder is sent.
 *
 * - **Debit** (they owe more): an issued invoice or deposit invoice, a refund paid to them.
 * - **Credit** (they owe less): a credit note, money received.
 * - **Balance**: debits less credits; negative is credit in their favour.
 *
 * ⚠️ Money is counted once, as the receipt: a transfer allocated to two invoices is one credit
 * line, not two — the allocations say where it went, not that it arrived twice. A deposit invoice
 * and the balance invoice that takes it off are both debits, and together they are the order,
 * because the balance is net of the deposit (I11).
 *
 * Per currency, never summed across two.
 */
import { sql } from "drizzle-orm";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type StatementKind = "invoice" | "deposit_invoice" | "credit_note" | "receipt" | "refund";

export interface StatementRow {
  date: string;
  kind: StatementKind;
  document: string | null;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface Statement {
  currency: string;
  /** The balance before `from`. */
  opening: number;
  rows: StatementRow[];
  closing: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] })?.rows ?? [])) as T[];

interface Movement {
  currency: string;
  date: string;
  kind: StatementKind;
  document: string | null;
  reference: string | null;
  amount: string;
  seq: string;
}

export async function customerStatement(
  db: AnyDb,
  input: { companyId: string; timeZone: string; from?: string | null; to?: string | null },
): Promise<Statement[]> {
  const tz = input.timeZone;
  const result = await db.execute(sql`
    select currency, issue_date::text as date,
           case document_type when 'TD04' then 'credit_note' when 'TD02' then 'deposit_invoice' else 'invoice' end as kind,
           document_number as document, null as reference,
           case when document_type = 'TD04' then -total else total end as amount,
           coalesce(number, 0)::text as seq
    from invoice
    where company_id = ${input.companyId} and status = 'issued' and document_type in ('TD01', 'TD02', 'TD04')
    union all
    select currency, to_char(received_at at time zone 'UTC' at time zone ${tz}, 'YYYY-MM-DD') as date,
           case when amount < 0 then 'refund' else 'receipt' end as kind,
           null as document, reference,
           -amount as amount,
           to_char(created_at, 'YYYYMMDDHH24MISSUS') as seq
    from receipt
    where company_id = ${input.companyId}`);

  const byCurrency = new Map<string, Movement[]>();
  for (const m of rowsOf<Movement>(result)) byCurrency.set(m.currency, [...(byCurrency.get(m.currency) ?? []), m]);

  // Documents before money on the same day: an invoice paid on the day it is issued reads as
  // owed, then paid — not as credit for a moment.
  const order = (k: StatementKind) => (k === "invoice" || k === "deposit_invoice" ? 0 : k === "credit_note" ? 1 : 2);
  return [...byCurrency.entries()]
    .sort(([a], [b]) => Number(b === "EUR") - Number(a === "EUR") || a.localeCompare(b))
    .map(([currency, list]) => {
      const sorted = list.sort(
        (a, b) => a.date.localeCompare(b.date) || order(a.kind) - order(b.kind) || a.seq.localeCompare(b.seq),
      );
      let balance = 0;
      let opening = 0;
      const rows: StatementRow[] = [];
      for (const m of sorted) {
        const amount = Number(m.amount);
        if (input.to && m.date > input.to) continue;
        balance = round2(balance + amount);
        if (input.from && m.date < input.from) {
          opening = balance;
          continue;
        }
        rows.push({
          date: m.date,
          kind: m.kind,
          document: m.document,
          reference: m.reference,
          debit: amount > 0 ? round2(amount) : 0,
          credit: amount < 0 ? round2(-amount) : 0,
          balance,
        });
      }
      return { currency, opening, rows, closing: balance };
    });
}

/**
 * Cash figures that can be checked (I14): what came in, what was invoiced, how long customers
 * take, what share of what was due has arrived, and money that no document explains yet.
 *
 * ⚠️⚠️ **Each figure has one definition, written here and shown beside the number** (the
 * `finance.cash.definitions` messages say the same in words). A figure is only verifiable when
 * the reader knows what it counts; "revenue" on the old Finance page was won deals, and nobody
 * could have told.
 *
 * - **Collected**: receipts by the day they reached the account, refunds (negative receipts)
 *   included — cash, whatever it was allocated to. Per currency, never summed across two.
 * - **Invoiced**: issued invoices and deposit invoices by issue date, VAT included, less the
 *   credit notes issued in the same month.
 * - **DSO**: what customers owe today ÷ what was invoiced in the last 90 days, net of credit
 *   notes, × 90. Null when nothing was invoiced: a ratio of nothing is not zero days.
 * - **Collection rate**, gross on gross: of the invoices issued in the last twelve months, what
 *   they ask that is already due (the installments already due, for one paid in parts; after credit
 *   notes), and what share of it has been paid. VAT on both
 *   sides, so the rate is not flattered or depressed by it.
 * - **Deposits to invoice**: money received on orders that no invoice carries yet — a payment
 *   before the supply has to be invoiced when it arrives (I11).
 * - **Customers' credit**: receipts not allocated to anything.
 *
 * A few grouped statements per page, whatever the number of documents.
 */
import { sql } from "drizzle-orm";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface CashStats {
  /** The twelve months, oldest first, as YYYY-MM on the workspace's clock. */
  months: string[];
  /** Per currency, one value per month. */
  collected: { currency: string; values: number[] }[];
  invoiced: { currency: string; values: number[] }[];
  collectedThisMonth: CurrencyAmount[];
  collectedLastMonth: CurrencyAmount[];
  dso: { currency: string; days: number | null; owed: number; invoiced90: number }[];
  collectionRate: { currency: string; rate: number | null; paid: number; asked: number }[];
  depositsToInvoice: {
    total: CurrencyAmount[];
    orders: { id: string; orderNumber: string; companyName: string | null; currency: string; amount: number }[];
  };
  customersCredit: CurrencyAmount[];
  /** Who holds that credit, the largest first (ten): each to use on an invoice, or to give back. */
  creditCustomers: { id: string; name: string | null; currency: string; amount: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] })?.rows ?? [])) as T[];

/** YYYY-MM of the month `offset` months from the one holding `today` (YYYY-MM-DD). */
export function monthKey(today: string, offset: number): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** DSO from what is owed now and what was invoiced over `window` days; null when nothing was. */
export function daysSalesOutstanding(owed: number, invoiced: number, window = 90): number | null {
  if (!(invoiced > 0)) return null;
  return Math.round((owed / invoiced) * window);
}

/** Share of what was asked that was paid, 0–1; null when nothing was asked. */
export function collectionRate(paid: number, asked: number): number | null {
  if (!(asked > 0)) return null;
  return Math.min(1, Math.max(0, paid / asked));
}

function series(
  rows: { currency: string; month: string; amount: string | number }[],
  months: string[],
): { currency: string; values: number[] }[] {
  const byCurrency = new Map<string, number[]>();
  for (const r of rows) {
    const i = months.indexOf(r.month);
    if (i === -1) continue;
    const values = byCurrency.get(r.currency) ?? months.map(() => 0);
    values[i] = round2(values[i] + Number(r.amount));
    byCurrency.set(r.currency, values);
  }
  return [...byCurrency.entries()].map(([currency, values]) => ({ currency, values }));
}

export async function cashStats(db: AnyDb, input: { today: string; timeZone: string }): Promise<CashStats> {
  const months = Array.from({ length: 12 }, (_, i) => monthKey(input.today, i - 11));
  const from = `${months[0]}-01`;
  const tz = input.timeZone;

  const [collectedRows, invoicedRows, owedRows, invoiced90Rows, rateRows, depositRows, creditRows, creditorRows] =
    await Promise.all([
      // Receipts by the month they arrived, on the workspace's clock.
      db.execute(sql`
      select currency, to_char(received_at at time zone 'UTC' at time zone ${tz}, 'YYYY-MM') as month, sum(amount) as amount
      from receipt
      where (received_at at time zone 'UTC' at time zone ${tz})::date >= ${from}::date
      group by 1, 2`),
      // Invoices and deposit invoices by issue date, less the credit notes of the same month.
      db.execute(sql`
      select currency, to_char(issue_date, 'YYYY-MM') as month,
             sum(case when document_type = 'TD04' then -total else total end) as amount
      from invoice
      where status = 'issued' and document_type in ('TD01', 'TD02', 'TD04') and issue_date >= ${from}::date
      group by 1, 2`),
      // What customers owe today: what is due on each issued invoice, less what was paid on it.
      db.execute(sql`
      select i.currency, sum(greatest(0, i.total - i.credited_amount - coalesce(p.paid, 0))) as owed
      from invoice i
      left join (select invoice_id, sum(amount) as paid from order_payment where invoice_id is not null group by invoice_id) p
        on p.invoice_id = i.id
      where i.status = 'issued' and i.document_type in ('TD01', 'TD02')
      group by 1`),
      db.execute(sql`
      select currency, sum(case when document_type = 'TD04' then -total else total end) as invoiced
      from invoice
      -- Net of credit notes, like "invoiced": a cancelled invoice is not sales to divide by.
      where status = 'issued' and document_type in ('TD01', 'TD02', 'TD04') and issue_date > ${input.today}::date - 90
      group by 1`),
      // Invoices of the last twelve months already due: what they ask and what was paid, capped.
      db.execute(sql`
      -- ⚠️ Paid in installments, an invoice asks for the installments already due: its due date is
      -- the last one, and twelve monthly installments left it out of the rate for a year.
      with due as (
        select i.currency,
               case when jsonb_array_length(coalesce(i.installments, '[]'::jsonb)) > 1
                    then least(i.total - i.credited_amount, coalesce((
                      select sum((x->>'amount')::numeric) from jsonb_array_elements(i.installments) x
                      where (x->>'dueDate')::date < ${input.today}::date), 0))
                    when coalesce(i.due_date, i.issue_date) < ${input.today}::date then i.total - i.credited_amount
                    else 0 end as asked,
               coalesce(p.paid, 0) as paid
        from invoice i
        left join (select invoice_id, sum(amount) as paid from order_payment where invoice_id is not null group by invoice_id) p
          on p.invoice_id = i.id
        where i.status = 'issued' and i.document_type in ('TD01', 'TD02')
          and i.issue_date > ${input.today}::date - 365
      )
      select currency, sum(asked) as asked, sum(least(asked, greatest(0, paid))) as paid
      from due where asked > 0
      group by 1`),
      // Money on orders that no invoice carries.
      db.execute(sql`
      select o.id, o.order_number, o.currency, c.name as company_name, sum(p.amount) as amount
      from order_payment p
      join "order" o on o.id = p.order_id
      left join company c on c.id = o.company_id
      where p.invoice_id is null and o.status <> 'cancelled'
      group by o.id, o.order_number, o.currency, c.name
      having sum(p.amount) > 0
      order by sum(p.amount) desc`),
      db.execute(sql`
      select r.currency, sum(r.amount - coalesce(a.allocated, 0)) as credit
      from receipt r
      left join (select receipt_id, sum(amount) as allocated from order_payment where receipt_id is not null group by receipt_id) a
        on a.receipt_id = r.id
      group by 1`),
      db.execute(sql`
      select r.company_id as id, c.name, r.currency, sum(r.amount - coalesce(a.allocated, 0)) as credit
      from receipt r
      left join (select receipt_id, sum(amount) as allocated from order_payment where receipt_id is not null group by receipt_id) a
        on a.receipt_id = r.id
      left join company c on c.id = r.company_id
      group by 1, 2, 3
      having sum(r.amount - coalesce(a.allocated, 0)) >= 0.01
      order by 4 desc
      limit 10`),
    ]);

  const collected = series(rowsOf(collectedRows), months);
  const thisMonth = months[11];
  const lastMonth = months[10];
  const monthly = (key: string) =>
    collected
      .map((s) => ({ currency: s.currency, amount: s.values[months.indexOf(key)] }))
      .filter((a) => a.amount !== 0);

  const owed = new Map(rowsOf<{ currency: string; owed: string }>(owedRows).map((r) => [r.currency, Number(r.owed)]));
  const invoiced90 = new Map(
    rowsOf<{ currency: string; invoiced: string }>(invoiced90Rows).map((r) => [r.currency, Number(r.invoiced)]),
  );
  const dsoCurrencies = [...new Set([...owed.keys(), ...invoiced90.keys()])];

  const deposits = rowsOf<{
    id: string;
    order_number: string;
    currency: string;
    company_name: string | null;
    amount: string;
  }>(depositRows).map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    companyName: r.company_name,
    currency: r.currency,
    amount: round2(Number(r.amount)),
  }));
  const depositTotals = new Map<string, number>();
  for (const d of deposits) depositTotals.set(d.currency, round2((depositTotals.get(d.currency) ?? 0) + d.amount));

  return {
    months,
    collected,
    invoiced: series(rowsOf(invoicedRows), months),
    collectedThisMonth: monthly(thisMonth),
    collectedLastMonth: monthly(lastMonth),
    dso: dsoCurrencies.map((currency) => ({
      currency,
      owed: round2(owed.get(currency) ?? 0),
      invoiced90: round2(invoiced90.get(currency) ?? 0),
      days: daysSalesOutstanding(owed.get(currency) ?? 0, invoiced90.get(currency) ?? 0),
    })),
    collectionRate: rowsOf<{ currency: string; asked: string; paid: string }>(rateRows).map((r) => ({
      currency: r.currency,
      asked: round2(Number(r.asked)),
      paid: round2(Number(r.paid)),
      rate: collectionRate(Number(r.paid), Number(r.asked)),
    })),
    depositsToInvoice: {
      total: [...depositTotals.entries()].map(([currency, amount]) => ({ currency, amount })),
      orders: deposits.slice(0, 10),
    },
    customersCredit: rowsOf<{ currency: string; credit: string }>(creditRows)
      .map((r) => ({ currency: r.currency, amount: round2(Number(r.credit)) }))
      .filter((c) => c.amount >= 0.01),
    creditCustomers: rowsOf<{ id: string; name: string | null; currency: string; credit: string }>(creditorRows).map(
      (r) => ({ id: r.id, name: r.name, currency: r.currency, amount: round2(Number(r.credit)) }),
    ),
  };
}

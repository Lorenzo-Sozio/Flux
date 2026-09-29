import { sql } from "drizzle-orm";

import { rowsOf, together } from "@/lib/db-together";

/**
 * Issuing an invoice: the number, the date and the frozen parties, in one statement.
 *
 * ⚠️⚠️ **Italian invoices are numbered without gaps.** The order counter tolerates
 * a skipped number; this one cannot. So the counter is not advanced in a statement
 * of its own and the invoice updated in another — a failure between them is a gap.
 * One statement does all of it:
 *
 *   1. `target` locks the draft `FOR UPDATE`, and only if it is still a draft at the
 *      expected revision;
 *   2. `next` advances the counter *from `target`* — no draft, no row, no increment;
 *   3. the UPDATE writes number, date and snapshots from `next`.
 *
 * Two people pressing "Issue" together: the second waits on the row lock, then sees
 * the invoice is no longer a draft, so its `target` is empty and its counter is not
 * touched. Postgres does that re-check itself (EvalPlanQual); the tests pin the
 * logical half — no draft, no number — on a real Postgres.
 *
 * A single statement is atomic on the Neon HTTP driver, which holds no transaction
 * across statements.
 *
 * ⚠️⚠️ **A credit note takes its amount back in the same statement.** `credit`
 * advances the original invoice's `credited_amount` only while what is left covers
 * this note, and `next` numbers the note only when `credit` did. Two credit notes
 * issued together on one invoice queue on the original's row; the second re-reads
 * it after the first commits (the condition is on the row being updated, which
 * Postgres re-checks), finds too little left, and takes neither an amount nor a
 * number. A check made in a separate query first, or even in a subquery here,
 * would read the old figure and let both through.
 *
 * ⚠️⚠️ **A balance invoice takes its deposits off in the same statement** (I11). `eligible` locks
 * each deposit invoice (TD02) it names, while no other invoice has taken it off and its credited
 * amount is the one the deduction was computed from; `ok` goes on only when all of them are
 * there, and `deduct` marks them only then. Two balance invoices of one order issued together
 * queue on the deposit's row; the second finds it taken and takes no number.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

export interface IssueInput {
  invoiceId: string;
  /** The draft revision whose lines and totals were checked. */
  revision: number;
  /** TD01, TD02 or TD04: what the order checks below apply to. */
  documentType?: string;
  /** The order the invoice is for, if any: issuing locks it, so two invoices of one order queue. */
  orderId?: string | null;
  scope: string;
  series: string;
  fiscalYear: number;
  issueDate: string;
  issuedBy: string | null;
  issuerSnapshot: unknown;
  customerSnapshot: unknown;
  /** The lines the totals were computed from, stamp recharge line included. */
  linesSnapshot: unknown;
  /** For a credit note, the issued invoice it gives back from; null for an invoice. */
  creditOf?: string | null;
  /**
   * For a balance invoice, the deposit invoices (TD02) it takes off, each with the credited
   * amount its deduction was computed from: a credit note issued on it meanwhile changes what
   * is left to take off, and the issue is refused rather than taking off the old figure.
   */
  deducts?: readonly { id: string; credited: number }[];
  /** The installments the terms became (I12): frozen with the invoice, the last one its due date. */
  installments?: readonly { dueDate: string; amount: number }[] | null;
  stampDuty: boolean;
  totals: {
    subtotal: number;
    discountAmount: number;
    taxableAmount: number;
    taxAmount: number;
    total: number;
  };
}

/** How far deposit invoices may go past the order's total: VAT per line on the order, per rate here. */
const ORDER_ROUNDING = 0.05;

export function issueStatement(input: IssueInput) {
  const money = (n: number) => n.toFixed(2);
  const seen = new Set<string>();
  const deducts = (input.deducts ?? []).filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
  const deductsJson = JSON.stringify(deducts.map((d) => ({ id: d.id, credited: money(d.credited) })));
  const docType = input.documentType ?? "TD01";
  const orderId = input.orderId ?? null;
  return sql`
    WITH target AS (
      SELECT id FROM invoice
      WHERE id = ${input.invoiceId} AND status = 'draft' AND revision = ${input.revision}
      FOR UPDATE
    ),
    -- The deposits to take off, locked, and only as they were when their deduction was computed.
    eligible AS (
      SELECT i.id FROM invoice i
      JOIN jsonb_to_recordset(${deductsJson}::jsonb) AS d(id text, credited numeric) ON d.id = i.id
      WHERE i.status = 'issued' AND i.document_type = 'TD02'
        AND i.deducted_in_invoice_id IS NULL
        AND i.credited_amount = d.credited
        AND i.credited_amount < i.total
      FOR UPDATE OF i
    ),
    -- Every condition, decided once, before anything is written. A data-modifying CTE runs
    -- whatever the others decide: gating each write on its own condition marked one deposit of
    -- two as taken off by a balance that was then refused, and it stayed marked for good.
    ok AS (
      SELECT 1 AS yes FROM target
      WHERE (SELECT count(*) FROM eligible) = ${deducts.length}
        -- The day it is dated is the day it is numbered: a request waiting on a lock across
        -- midnight would otherwise date number N+1 before number N.
        AND ${input.issueDate}::date = (now() AT TIME ZONE 'Europe/Rome')::date
        -- One invoice of an order that is not credited back, and no deposit of it left out.
        AND (${docType} <> 'TD01' OR ${orderId}::text IS NULL OR NOT EXISTS (
          SELECT 1 FROM invoice o
          WHERE o.order_id = ${orderId} AND o.id <> ${input.invoiceId} AND o.status = 'issued'
            AND ((o.document_type = 'TD01' AND o.credited_amount < o.total)
              OR (o.document_type = 'TD02' AND o.deducted_in_invoice_id IS NULL
                  AND o.credited_amount < o.total AND o.id NOT IN (SELECT id FROM eligible)))))
        -- Deposits never add up to more than the order.
        AND (${docType} <> 'TD02' OR ${orderId}::text IS NULL OR (
          SELECT coalesce(sum(o.total - o.credited_amount), 0) FROM invoice o
          WHERE o.order_id = ${orderId} AND o.id <> ${input.invoiceId} AND o.status = 'issued'
            AND o.document_type IN ('TD01', 'TD02')
        ) + ${money(input.totals.total)}::numeric
          <= (SELECT total_amount FROM "order" WHERE id = ${orderId}) + ${money(ORDER_ROUNDING)}::numeric)
    ),
    credit AS (
      UPDATE invoice SET credited_amount = credited_amount + ${money(input.totals.total)}::numeric, updated_at = now()
      WHERE id = ${input.creditOf ?? null}::text
        AND status = 'issued' AND document_type IN ('TD01', 'TD02')
        -- A deposit already taken off a balance invoice is corrected there, not here.
        AND deducted_in_invoice_id IS NULL
        AND total - credited_amount >= ${money(input.totals.total)}::numeric
        AND EXISTS (SELECT 1 FROM ok)
      RETURNING id, total, credited_amount
    ),
    -- A balance invoice credited back in full gives its deposits back: the order is invoiced
    -- again, and the new balance takes them off.
    released AS (
      UPDATE invoice SET deducted_in_invoice_id = NULL, updated_at = now()
      WHERE deducted_in_invoice_id = ${input.creditOf ?? null}::text
        AND EXISTS (SELECT 1 FROM credit c WHERE c.credited_amount >= c.total)
      RETURNING id
    ),
    deduct AS (
      UPDATE invoice SET deducted_in_invoice_id = ${input.invoiceId}, updated_at = now()
      WHERE id IN (SELECT id FROM eligible) AND EXISTS (SELECT 1 FROM ok)
      RETURNING id
    ),
    next AS (
      INSERT INTO document_counter (scope, last_value, updated_at)
      SELECT ${input.scope}, 1, now() FROM ok
      WHERE (${input.creditOf ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM credit))
      ON CONFLICT (scope) DO UPDATE SET last_value = document_counter.last_value + 1, updated_at = now()
      RETURNING last_value
    ),
    -- The SDI file's progressive, for a series other than the main one (migration 0063): taken
    -- only when the invoice is numbered, from a counter of its own.
    progressive AS (
      INSERT INTO document_counter (scope, last_value, updated_at)
      SELECT 'sdi-file', 1, now() FROM next WHERE ${input.series} <> ''
      ON CONFLICT (scope) DO UPDATE SET last_value = document_counter.last_value + 1, updated_at = now()
      RETURNING last_value
    )
    UPDATE invoice SET
      status = 'issued',
      number = next.last_value,
      fiscal_year = ${input.fiscalYear},
      document_number = CASE WHEN ${input.series} = '' THEN next.last_value::text
                             ELSE next.last_value::text || '/' || ${input.series} END,
      issue_date = ${input.issueDate}::date,
      issued_at = now(),
      issued_by = ${input.issuedBy},
      issuer_snapshot = ${JSON.stringify(input.issuerSnapshot)}::jsonb,
      customer_snapshot = ${JSON.stringify(input.customerSnapshot)}::jsonb,
      lines_snapshot = ${JSON.stringify(input.linesSnapshot)}::jsonb,
      stamp_duty = ${input.stampDuty},
      subtotal = ${money(input.totals.subtotal)},
      discount_amount = ${money(input.totals.discountAmount)},
      taxable_amount = ${money(input.totals.taxableAmount)},
      tax_amount = ${money(input.totals.taxAmount)},
      total = ${money(input.totals.total)},
      installments = ${input.installments?.length ? JSON.stringify(input.installments) : null}::jsonb,
      due_date = coalesce(${input.installments?.length ? input.installments[input.installments.length - 1].dueDate : null}::date, invoice.due_date),
      sdi_progressive = (SELECT last_value FROM progressive),
      updated_at = now()
    FROM next
    -- Repeats what the target CTE already established in this same snapshot; kept so the
    -- UPDATE is correct read on its own, not because it changes the outcome.
    WHERE invoice.id = ${input.invoiceId} AND invoice.status = 'draft' AND invoice.revision = ${input.revision}
    RETURNING invoice.id, invoice.number, invoice.document_number
  `;
}

/**
 * The issued number, or null when the draft was already issued, changed since it was checked,
 * or an order check refused it.
 *
 * ⚠️⚠️ An invoice of an order first locks the order, **in a statement of its own**, in the same
 * transaction. The order checks in `ok` read the statement's snapshot, taken when it starts; were
 * the lock inside the same statement, the second of two invoices of one order issued together
 * would wait for it and then check against a snapshot from before the first was issued.
 */
export async function issueInvoice(
  db: AnyDb,
  input: IssueInput,
): Promise<{ number: number; documentNumber: string } | null> {
  const orderId = input.orderId ?? null;
  const results = await together(db, (h) => [
    ...(orderId ? [h.execute(sql`SELECT id FROM "order" WHERE id = ${orderId} FOR UPDATE`)] : []),
    h.execute(issueStatement(input)),
  ]);
  const rows = rowsOf<{ number: number; document_number: string }>(results[results.length - 1]);
  const row = rows[0];
  return row ? { number: Number(row.number), documentNumber: row.document_number } : null;
}

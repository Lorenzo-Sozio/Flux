import { sql } from "drizzle-orm";

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
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

export interface IssueInput {
  invoiceId: string;
  /** The draft revision whose lines and totals were checked. */
  revision: number;
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
  stampDuty: boolean;
  totals: {
    subtotal: number;
    discountAmount: number;
    taxableAmount: number;
    taxAmount: number;
    total: number;
  };
}

export function issueStatement(input: IssueInput) {
  const money = (n: number) => n.toFixed(2);
  return sql`
    WITH target AS (
      SELECT id FROM invoice
      WHERE id = ${input.invoiceId} AND status = 'draft' AND revision = ${input.revision}
      FOR UPDATE
    ),
    credit AS (
      UPDATE invoice SET credited_amount = credited_amount + ${money(input.totals.total)}::numeric, updated_at = now()
      WHERE id = ${input.creditOf ?? null}::text
        AND status = 'issued' AND document_type = 'TD01'
        AND total - credited_amount >= ${money(input.totals.total)}::numeric
        AND EXISTS (SELECT 1 FROM target)
      RETURNING id
    ),
    next AS (
      INSERT INTO document_counter (scope, last_value, updated_at)
      SELECT ${input.scope}, 1, now() FROM target
      WHERE ${input.creditOf ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM credit)
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
      updated_at = now()
    FROM next
    -- Repeats what the target CTE already established in this same snapshot; kept so the
    -- UPDATE is correct read on its own, not because it changes the outcome.
    WHERE invoice.id = ${input.invoiceId} AND invoice.status = 'draft' AND invoice.revision = ${input.revision}
    RETURNING invoice.id, invoice.number, invoice.document_number
  `;
}

/** The issued number, or null when the draft was already issued or changed since it was checked. */
export async function issueInvoice(
  db: AnyDb,
  input: IssueInput,
): Promise<{ number: number; documentNumber: string } | null> {
  const result = await db.execute(issueStatement(input));
  const rows: { number: number; document_number: string }[] = Array.isArray(result) ? result : (result?.rows ?? []);
  const row = rows[0];
  return row ? { number: Number(row.number), documentNumber: row.document_number } : null;
}

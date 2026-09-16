import { addDays } from "@/lib/contract-terms";
import { round2 } from "@/lib/document-totals";
import { invoiceTotals } from "@/lib/fatturapa/totals";

/**
 * Imposta di bollo on electronic invoices.
 *
 * ⚠️⚠️ Decided from the Natura of each line, never from a checkbox. A missing stamp
 * is found by the Agenzia delle Entrate from SDI data and charged with penalties; a
 * stamp charged where none is due is money taken from a customer for nothing. The
 * rules are few and exact, and a person should not have to remember them:
 *
 *   * €2.00 is due when the lines **without VAT** add up to more than €77.47 —
 *     their own total, not the invoice's (Tariffa, all. A, DPR 642/1972, art. 13
 *     nota 3; art. 6 DM 17 giugno 2014 for electronic invoices).
 *   * Exports, supplies to San Marino and operations treated as exports are exempt
 *     (art. 15 Tabella B, DPR 642/1972): N3.1, N3.3, N3.4.
 *   * Intra-EU supplies are exempt (art. 66 DL 331/1993): N3.2.
 *   * ⚠️ Supplies to a habitual exporter under a **dichiarazione d'intento** (N3.5)
 *     are *not* exempt, although they are non-taxable like exports. The single
 *     most common mistake, and the reason a blanket "N3 is exempt" is wrong.
 *   * Margin-scheme invoices (N5) show no VAT because it is inside the price, not
 *     because the operation is outside it: no stamp.
 *
 * The case law has corners — N3.6 covers operations with different treatments,
 * and some customers carry a subjective exemption — so an override exists, and it
 * requires a written reason that stays on the invoice.
 */

export const STAMP_DUTY_AMOUNT = 2;
export const STAMP_DUTY_THRESHOLD = 77.47;

/** How each Natura code counts towards the threshold. */
export const NATURE_STAMP_TREATMENT: Record<string, "counts" | "exempt" | "not_applicable"> = {
  N1: "counts",
  "N2.1": "counts",
  "N2.2": "counts",
  "N3.1": "exempt",
  "N3.2": "exempt",
  "N3.3": "exempt",
  "N3.4": "exempt",
  "N3.5": "counts",
  "N3.6": "counts",
  N4: "counts",
  N5: "not_applicable",
};

/** The description of the line that recharges the stamp to the customer. */
export const STAMP_LINE_DESCRIPTION = "Imposta di bollo assolta in modo virtuale";
/** The recharge line is itself excluded from VAT under art. 15. */
export const STAMP_LINE_NATURE = "N1";

export interface StampLine {
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  taxPercent: number;
  nature?: string | null;
  /** The recharge line added by `withStampRecharge`, never counted towards its own threshold. */
  isStampRecharge?: boolean;
}

export type StampMode = "auto" | "force_on" | "force_off";

export interface StampAssessment {
  /** Whether the rules make the stamp due. */
  due: boolean;
  /** Whether the invoice carries it, after any override. */
  applied: boolean;
  /** Total of the lines that count towards the threshold, after the document discount. */
  base: number;
  /** Total of zero-rate lines that are exempt from stamp duty. */
  exemptBase: number;
  reason:
    | "above_threshold"
    | "below_threshold"
    | "only_exempt_lines"
    | "no_vat_free_lines"
    | "forced_on"
    | "forced_off";
}

export function assessStampDuty(
  lines: readonly StampLine[],
  discountPercent = 0,
  mode: StampMode = "auto",
): StampAssessment {
  const counted = lines.filter((l) => !l.isStampRecharge);
  // The same per-(rate, Natura) figures the XML summary carries, so the base that
  // decides the stamp is the base SDI sees, to the cent.
  const { summary } = invoiceTotals(
    counted.map((l) => ({ ...l, description: "" })),
    discountPercent,
  );
  let base = 0;
  let exemptBase = 0;
  for (const row of summary) {
    if (row.rate !== 0) continue;
    const treatment = NATURE_STAMP_TREATMENT[row.nature ?? ""] ?? "counts";
    if (treatment === "counts") base += row.taxable;
    else if (treatment === "exempt") exemptBase += row.taxable;
  }
  base = round2(base);
  exemptBase = round2(exemptBase);
  const due = base > STAMP_DUTY_THRESHOLD;

  const reason: StampAssessment["reason"] =
    mode === "force_on"
      ? "forced_on"
      : mode === "force_off"
        ? "forced_off"
        : due
          ? "above_threshold"
          : base > 0
            ? "below_threshold"
            : exemptBase > 0
              ? "only_exempt_lines"
              : "no_vat_free_lines";

  return { due, applied: mode === "force_on" ? true : mode === "force_off" ? false : due, base, exemptBase, reason };
}

/**
 * The lines with the stamp recharged to the customer, when it applies and the
 * issuer recharges it. Any previous recharge line is replaced, never duplicated.
 */
export function withStampRecharge<T extends StampLine & { description: string }>(
  lines: readonly T[],
  applied: boolean,
  recharge: boolean,
): (T | (StampLine & { description: string }))[] {
  const own = lines.filter((l) => !l.isStampRecharge);
  if (!applied || !recharge) return own;
  return [
    ...own,
    {
      description: STAMP_LINE_DESCRIPTION,
      quantity: 1,
      unitPrice: STAMP_DUTY_AMOUNT,
      discountPercent: 0,
      taxPercent: 0,
      nature: STAMP_LINE_NATURE,
      isStampRecharge: true,
    },
  ];
}

// ─── Quarterly payment ────────────────────────────────────────────────────────

/** F24 tax codes for virtual stamp duty on electronic invoices, by quarter. */
export const F24_CODES = { 1: "2521", 2: "2522", 3: "2523", 4: "2524" } as const;

/** Below this, a quarter's payment may be deferred (art. 17 DL 124/2019, as amended by DL 73/2022). */
export const DEFERRAL_THRESHOLD = 5000;

export interface QuarterDue {
  quarter: 1 | 2 | 3 | 4;
  invoices: number;
  amount: number;
  f24Code: string;
  /** The last day to pay this quarter, after any deferral. */
  dueDate: string;
  deferred: boolean;
}

/** The first working day on or after `day`: a deadline on a Saturday or Sunday moves to Monday. */
function workingDay(day: string): string {
  let d = day;
  for (let i = 0; i < 3; i++) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return d;
    d = addDays(d, 1);
  }
  return d;
}

/**
 * When each quarter's stamp duty is paid, for invoices issued in `year`.
 *
 * Ordinary deadlines: Q1 by 31 May, Q2 by 30 September, Q3 by 30 November, Q4 by the
 * end of February of the next year. Q1 under €5,000 moves to 30 September; Q1 and Q2
 * together still under €5,000 move to 30 November. Public holidays are not moved.
 *
 * ⚠️ A support figure. The Agenzia computes the amount from what reached SDI and
 * publishes it in the reserved area; that is the one to pay.
 */
export function quarterlyStampDuty(year: number, invoicesPerQuarter: Record<1 | 2 | 3 | 4, number>): QuarterDue[] {
  const amount = (q: 1 | 2 | 3 | 4) => round2(invoicesPerQuarter[q] * STAMP_DUTY_AMOUNT);
  const february = new Date(Date.UTC(year + 1, 2, 0)).getUTCDate();
  const ordinary: Record<1 | 2 | 3 | 4, string> = {
    1: `${year}-05-31`,
    2: `${year}-09-30`,
    3: `${year}-11-30`,
    4: `${year + 1}-02-${String(february).padStart(2, "0")}`,
  };
  const q1Deferred = amount(1) < DEFERRAL_THRESHOLD;
  const firstHalfDeferred = amount(1) + amount(2) < DEFERRAL_THRESHOLD;

  return ([1, 2, 3, 4] as const).map((quarter) => {
    let due = ordinary[quarter];
    let deferred = false;
    if (quarter === 1 && q1Deferred) {
      due = firstHalfDeferred ? ordinary[3] : ordinary[2];
      deferred = true;
    } else if (quarter === 2 && firstHalfDeferred) {
      due = ordinary[3];
      deferred = true;
    }
    return {
      quarter,
      invoices: invoicesPerQuarter[quarter],
      amount: amount(quarter),
      f24Code: F24_CODES[quarter],
      dueDate: workingDay(due),
      deferred,
    };
  });
}

/** The quarter a calendar day falls in. */
export function quarterOf(day: string): 1 | 2 | 3 | 4 {
  return (Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

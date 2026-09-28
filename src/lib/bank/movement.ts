/**
 * A line of a bank statement, as every format is reduced to it (I13).
 *
 * The file is read in the browser (CAMT.053 or CSV) and only these travel to the server, which
 * checks them again with `cleanMovement`: whatever the page sends is input like any other.
 */

export interface Movement {
  /** The day the bank booked it, YYYY-MM-DD. */
  bookedOn: string;
  valueOn?: string | null;
  /** Positive: money in. Negative: money out. */
  amount: number;
  currency: string;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  /** The description: remittance information, the bank's own text, whatever the file had. */
  remittance?: string | null;
  /** The bank's reference for the line (AcctSvcrRef, end-to-end id, CRO/TRN). */
  bankReference?: string | null;
  /**
   * Which of several identical lines in the file this is, from 1: numbered over the whole file
   * by the page (`numberRepeats`), because the file travels in chunks and a count restarted at
   * each chunk would call the second of two payments the first.
   */
  repeat?: number;
}

export type MovementProblem = "date" | "amount" | "currency";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** An IBAN written the one way: capitals, no spaces. Null when it is not shaped like one. */
export function normalizeIban(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const v = s.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(v) ? v : null;
}

const text = (s: unknown, max: number) => {
  if (typeof s !== "string") return null;
  const v = s.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

/** A movement as the server keeps it, or why it cannot be kept. */
export function cleanMovement(
  input: unknown,
): { ok: true; movement: Movement } | { ok: false; problem: MovementProblem } {
  const m = (input ?? {}) as Record<string, unknown>;
  if (!isDay(m.bookedOn)) return { ok: false, problem: "date" };
  const amount = typeof m.amount === "number" ? m.amount : Number.NaN;
  // Nothing moved is not a movement; above a billion is not a number anybody meant.
  if (!Number.isFinite(amount) || Math.round(amount * 100) === 0 || Math.abs(amount) >= 1e9)
    return { ok: false, problem: "amount" };
  const currency = typeof m.currency === "string" ? m.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, problem: "currency" };
  return {
    ok: true,
    movement: {
      bookedOn: m.bookedOn,
      valueOn: isDay(m.valueOn) ? m.valueOn : null,
      amount: Math.round(amount * 100) / 100,
      currency,
      counterpartyName: text(m.counterpartyName, 200),
      counterpartyIban: normalizeIban(m.counterpartyIban),
      remittance: text(m.remittance, 1000),
      bankReference: text(m.bankReference, 120),
      repeat:
        Number.isInteger(m.repeat) && (m.repeat as number) >= 1 && (m.repeat as number) <= 100_000
          ? (m.repeat as number)
          : 1,
    },
  };
}

/**
 * What makes a movement the same movement when a statement is imported again: the day, the
 * amount, the bank's reference and the description. Two identical lines in one file are two
 * payments (the same customer paying twice the same day), so repeats are numbered — `#2`,
 * `#3` — in the order the file gives them, and a file that overlaps an earlier one by whole
 * days numbers them the same way.
 */
export function fingerprintBase(m: Movement): string {
  const words = (m.remittance ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [m.bookedOn, Math.round(m.amount * 100), (m.bankReference ?? "").toLowerCase(), words].join("|");
}

/** Numbers identical lines over a whole file, in its order: 1, 2, 3 for each repeat. */
export function numberRepeats<T extends Movement>(movements: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return movements.map((m) => {
    const base = fingerprintBase(m);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...m, repeat: n };
  });
}

/** The key a movement is stored under: the same line imported twice collides on it. */
export function fingerprintOf(m: Movement): string {
  const n = m.repeat ?? 1;
  return n > 1 ? `${fingerprintBase(m)}#${n}` : fingerprintBase(m);
}

/** SHA-256, hex: what is stored and indexed, whatever the length of the description. */
export async function sha256Hex(s: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

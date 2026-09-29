import type { Movement } from "./movement";

/**
 * A bank's CSV export, read into movements (I13).
 *
 * Every bank writes its own: a preamble of account details before the header, one signed
 * amount or two columns (Dare / Avere), dates as 15/09/2026, amounts as 1.234,56. A mapping
 * says which column is what; it is kept per account by **header name**, not by position, so a
 * bank that adds a column does not shift every field into the wrong one — a missing header
 * asks for the mapping again instead.
 *
 * The rows come from papaparse in the browser; this module only interprets them, so the tests
 * read exactly what the page reads.
 */

export interface CsvMapping {
  date: string;
  valueDate?: string | null;
  /** One signed amount… */
  amount?: string | null;
  /** …or money in and money out in two columns. */
  credit?: string | null;
  debit?: string | null;
  description: string[];
  counterparty?: string | null;
  iban?: string | null;
  reference?: string | null;
  currency?: string | null;
  /** A column saying which way the amount goes (D/A, Dare/Avere, +/-), when the amount has no sign. */
  sign?: string | null;
  dateOrder: "dmy" | "ymd" | "mdy";
  decimal: "," | ".";
}

export type CsvProblem = "date" | "amount" | "balance";

export interface CsvRead {
  movements: Movement[];
  /** Data rows that could not be read, by line number in the file (from 1). */
  problems: { line: number; problem: CsvProblem }[];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** An amount as banks write it: "1.234,56", "-1234.56", "1.234,56-", "(12,00)", "€ 12,00". */
export function parseBankAmount(raw: string | null | undefined, decimal: "," | "."): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/\s| |€|EUR|\+/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = decimal === "," ? s.replace(/[.']/g, "").replace(",", ".") : s.replace(/[,']/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? (negative ? -v : v) : null;
}

/** A date as banks write it, into YYYY-MM-DD. */
export function parseBankDate(raw: string | null | undefined, order: CsvMapping["dateOrder"]): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let y: number;
  let m: number;
  let d: number;
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else {
    const p = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/.exec(s);
    if (!p) return null;
    const [a, b, c] = [+p[1], +p[2], +p[3]];
    if (order === "ymd") [y, m, d] = [a, b, c];
    else if (order === "mdy") [m, d, y] = [a, b, c];
    else [d, m, y] = [a, b, c];
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Header words, folded. The first match wins, so the more specific come first.
const WORDS = {
  date: ["data contabile", "data operazione", "data registrazione", "booking date", "data", "date"],
  valueDate: ["data valuta", "valuta", "value date"],
  amount: ["importo", "amount", "ammontare"],
  credit: ["avere", "entrate", "accrediti", "accredito", "credit"],
  debit: ["dare", "uscite", "addebiti", "addebito", "debit"],
  description: ["descrizione", "causale", "dettagli", "description", "memo", "motivo", "informazioni"],
  counterparty: ["ordinante", "controparte", "beneficiario", "nome", "payer", "counterparty", "name"],
  iban: ["iban"],
  reference: ["cro", "trn", "riferimento", "reference", "id operazione"],
  currency: ["divisa", "currency"],
  sign: ["segno", "d/a", "dare/avere", "dare avere", "c/d", "cd", "sign", "debit/credit"],
} as const;

const find = (headers: string[], words: readonly string[], taken: Set<number>, exact = false): number => {
  const folded = headers.map(fold);
  for (const w of words) {
    const i = folded.findIndex((h, k) => !taken.has(k) && (exact ? h === w : h === w || h.includes(w)));
    if (i !== -1) return i;
  }
  return -1;
};

/** The header row: the first of the first thirty with a date column and three filled cells. */
export function findHeaderRow(rows: readonly string[][]): number {
  // ⚠️ By score, not by the first row with "data" in it: a preamble "Data estrazione: 30/09/2026"
  // was taken as the header, and the file could not be read. A header names a date, an amount (or
  // credit and debit) and a description; the row naming most of them wins, the earliest on a tie.
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map((c) => fold(String(c ?? ""))).filter(Boolean);
    if (cells.length < 3) continue;
    const has = (words: readonly string[]) => cells.some((c) => words.some((w) => c === w || c.includes(w)));
    const score =
      Number(has(WORDS.date)) +
      Number(has(WORDS.amount) || (has(WORDS.credit) && has(WORDS.debit))) +
      Number(has(WORDS.description)) +
      Number(has(WORDS.valueDate));
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : 0;
}

/** A first guess at the mapping from the header and a few rows, to be corrected on screen. */
export function guessMapping(rows: readonly string[][]): { headerRow: number; mapping: CsvMapping | null } {
  const headerRow = findHeaderRow(rows);
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const taken = new Set<number>();
  const pick = (words: readonly string[], exact = false) => {
    const i = find(headers, words, taken, exact);
    if (i !== -1) taken.add(i);
    return i === -1 ? null : headers[i];
  };
  // Value date first: "Data valuta" would otherwise be taken as the booking date.
  const valueDate = pick(WORDS.valueDate);
  const date = pick(WORDS.date);
  const credit = pick(WORDS.credit, true) ?? pick(WORDS.credit);
  const debit = pick(WORDS.debit, true) ?? pick(WORDS.debit);
  const amount = credit && debit ? null : pick(WORDS.amount);
  const sign = amount ? pick(WORDS.sign, true) : null;
  const iban = pick(WORDS.iban);
  const reference = pick(WORDS.reference, true);
  const currency = pick(WORDS.currency);
  const counterparty = pick(WORDS.counterparty);
  const description: string[] = [];
  for (let d = pick(WORDS.description); d; d = pick(WORDS.description)) description.push(d);
  if (!date || (!amount && !(credit && debit))) return { headerRow, mapping: null };

  const sample = rows.slice(headerRow + 1, headerRow + 40);
  const col = (name: string | null) => (name ? headers.indexOf(name) : -1);
  const amountCells = [col(amount), col(credit), col(debit)]
    .filter((i) => i >= 0)
    .flatMap((i) => sample.map((r) => String(r[i] ?? "").trim()))
    .filter(Boolean);
  const commaDecimal = amountCells.filter((v) => /,\d{1,2}-?$/.test(v)).length;
  const dotDecimal = amountCells.filter((v) => /\.\d{1,2}-?$/.test(v)).length;
  const dates = sample.map((r) => String(r[col(date)] ?? "").trim()).filter(Boolean);
  const dateOrder: CsvMapping["dateOrder"] = dates.some((v) => /^\d{4}[-/.]/.test(v))
    ? "ymd"
    : dates.some((v) => /^\d{1,2}[/.-](1[3-9]|2\d|3[01])[/.-]/.test(v))
      ? "mdy"
      : "dmy";

  return {
    headerRow,
    mapping: {
      date,
      valueDate,
      amount,
      credit: amount ? null : credit,
      debit: amount ? null : debit,
      description,
      counterparty,
      iban,
      reference,
      currency,
      sign,
      dateOrder,
      decimal: dotDecimal > commaDecimal ? "." : ",",
    },
  };
}

/** The header names a mapping needs that this file does not have. */
export function missingColumns(headers: readonly string[], mapping: CsvMapping): string[] {
  const needed = [
    mapping.date,
    mapping.valueDate,
    mapping.amount,
    mapping.credit,
    mapping.debit,
    mapping.counterparty,
    mapping.iban,
    mapping.reference,
    mapping.currency,
    mapping.sign,
    ...mapping.description,
  ].filter((h): h is string => Boolean(h));
  return needed.filter((h) => !headers.includes(h));
}

/** A row that states a balance or a total, not a movement. */
const BALANCE_ROW = /^\s*(saldo|totale|totali|saldo iniziale|saldo finale|saldo contabile|saldo disponibile)\b/i;

export function readCsv(
  rows: readonly string[][],
  headerRow: number,
  mapping: CsvMapping,
  fallbackCurrency = "EUR",
): CsvRead {
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? "").trim());
  const at = (row: readonly string[], name: string | null | undefined) => {
    if (!name) return null;
    const i = headers.indexOf(name);
    const v = i === -1 ? "" : String(row[i] ?? "").trim();
    return v || null;
  };
  const out: CsvRead = { movements: [], problems: [] };
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    // Blank lines and footers ("Saldo finale", totals) have no date: skipped silently when the
    // whole row is empty, reported otherwise.
    if (!row || row.every((c) => !String(c ?? "").trim())) continue;
    const line = r + 1;
    // ⚠️ A balance row ("Saldo finale 30/09/2026 12.345,67") has a date and an amount: read as a
    // line, it became a payment of the whole balance. Any cell that starts with saldo or totale.
    if (row.some((c) => BALANCE_ROW.test(String(c ?? "")))) {
      out.problems.push({ line, problem: "balance" });
      continue;
    }
    const bookedOn = parseBankDate(at(row, mapping.date), mapping.dateOrder);
    if (!bookedOn) {
      out.problems.push({ line, problem: "date" });
      continue;
    }
    let amount: number | null;
    if (mapping.amount) amount = parseBankAmount(at(row, mapping.amount), mapping.decimal);
    else {
      const credit = parseBankAmount(at(row, mapping.credit), mapping.decimal);
      const debit = parseBankAmount(at(row, mapping.debit), mapping.decimal);
      // Some banks write Dare as a negative number, others as a positive one.
      amount = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
    }
    // ⚠️ A separate sign column: without it every line of such a file read as money in, and the
    // salaries were matched to customers.
    if (amount !== null && mapping.sign) {
      const way = (at(row, mapping.sign) ?? "").trim().toLowerCase();
      if (/^(d|dare|db|dbit|debit|debito|addebito|-)$/.test(way)) amount = -Math.abs(amount);
      else if (/^(a|avere|c|cr|crdt|credit|credito|accredito|\+)$/.test(way)) amount = Math.abs(amount);
    }
    if (amount === null || Math.round(amount * 100) === 0) {
      out.problems.push({ line, problem: "amount" });
      continue;
    }
    const description = mapping.description
      .map((h) => at(row, h))
      .filter(Boolean)
      .join(" ");
    out.movements.push({
      bookedOn,
      valueOn: parseBankDate(at(row, mapping.valueDate), mapping.dateOrder),
      amount: Math.round(amount * 100) / 100,
      currency: (at(row, mapping.currency) ?? fallbackCurrency).toUpperCase(),
      counterpartyName: at(row, mapping.counterparty),
      counterpartyIban: at(row, mapping.iban),
      remittance: description || null,
      bankReference: at(row, mapping.reference),
    });
  }
  return out;
}

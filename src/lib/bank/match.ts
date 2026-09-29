/**
 * What a bank line probably is (I13): proposals, each with a score and its reasons in words.
 *
 * Pure: the queue loads what is open once and runs this for every line, and the tests run it
 * on hand-made cases. It proposes; it never decides. A person confirms — one at a time, or in
 * bulk the proposals marked `sure`.
 *
 * ⚠️⚠️ **Money already written down by hand comes first.** A payment typed on an invoice before
 * the statement arrived is a receipt already; the bank line is the same money. Proposing a new
 * receipt beside it would count it twice in "collected" and pay the invoice twice. So a loose
 * receipt of the same amount, near the same day, is offered as a *link*, and outranks a new
 * receipt for the same invoice.
 *
 * ⚠️⚠️ **`sure` is narrow on purpose.** Only a proposal that explains the whole amount, with no
 * credit left over, with no rival close behind, no ambiguity (two invoices owing the same) and
 * no disagreement between signals (the reference names one customer, the IBAN another). Bulk
 * confirmation acts on `sure` only; everything else waits for a person.
 *
 * The signals, strongest first: the invoice number in the description; the payer's IBAN,
 * already seen for that customer; the amount equal to what an invoice (or several) still owes;
 * the payer's name resembling the customer's; the due date near the day it arrived.
 */

export interface MatchTx {
  /** What is left of the line to explain: its amount less what is already linked to it. */
  amount: number;
  currency: string;
  bookedOn: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittance: string | null;
}

export interface OpenInvoice {
  id: string;
  documentNumber: string | null;
  issueDate: string | null;
  dueDate: string;
  companyId: string | null;
  currency: string;
  outstanding: number;
  /** Paid in installments (I12): what the next installment still owes; `dueDate` is its day. */
  nextInstallment?: number | null;
}

export interface OpenOrder {
  id: string;
  orderNumber: string;
  companyId: string | null;
  currency: string;
  outstanding: number;
}

/** A receipt typed by hand and not yet tied to a bank line. */
export interface LooseReceipt {
  id: string;
  companyId: string | null;
  amount: number;
  currency: string;
  receivedOn: string;
}

export interface MatchContext {
  invoices: readonly OpenInvoice[];
  orders: readonly OpenOrder[];
  receipts: readonly LooseReceipt[];
  /** IBAN → the customers it has paid for, learned from every confirmation. */
  ibans: ReadonlyMap<string, readonly string[]>;
  /** How many confirmations taught each "iban|companyId": once is a hint, twice a habit. */
  ibanSeen?: ReadonlyMap<string, number>;
  companies: readonly { id: string; name: string }[];
}

export type Reason =
  | { code: "invoice_number"; number: string }
  | { code: "order_number"; number: string }
  | { code: "iban_known" }
  | { code: "iban_shared" }
  | { code: "payer_name" }
  | { code: "amount_exact" }
  | { code: "installment_exact" }
  | { code: "amount_sum"; count: number }
  | { code: "oldest_first" }
  | { code: "credit_only" }
  | { code: "credit_left"; amount: number }
  | { code: "due_near"; days: number }
  | { code: "receipt_same_amount"; count: number }
  | { code: "receipt_near"; days: number }
  | { code: "amount_only" }
  | { code: "ambiguous" }
  | { code: "other_payer" }
  | { code: "contested" }
  | { code: "recorded_already" }
  | { code: "possible_duplicate" }
  | { code: "reversal" };

export type Confidence = "sure" | "likely" | "weak";

export interface Allocation {
  invoiceId?: string;
  orderId?: string;
  amount: number;
}

export interface Proposal {
  /** Stable for the same content: what a bulk confirmation checks it still means. */
  key: string;
  companyId: string | null;
  allocations: Allocation[];
  /** Receipts already written down that this line is. */
  receiptIds: string[];
  /** What stays as the customer's credit. */
  credit: number;
  score: number;
  confidence: Confidence;
  reasons: Reason[];
}

export const SURE_SCORE = 70;
/** A rival this close to the best makes the best not sure. */
export const SURE_MARGIN = 20;
const RECEIPT_WINDOW_DAYS = 20;
const SUBSET_MAX_INVOICES = 15;
const SUBSET_MAX_SIZE = 4;

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

export function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Invoice numbers in a description ─────────────────────────────────────────

export interface InvoiceRef {
  number: number;
  series: string | null;
  year: number | null;
  /** Written as "12/2026" with no word saying it is an invoice: a hint, never a proof. */
  weak?: boolean;
}

const KEYWORD =
  /\b(?:fatt(?:ura|ure)?|fat|ft|fa|inv(?:oice)?|doc(?:umento)?|rif(?:erimento)?\.?\s*(?:ft|fatt(?:ura)?))\b\.?\s*(?:n(?:r|um|o)?\b\.?\s*|n°\s*|°\s*|#\s*)?/g;
const ITEM = /^(\d{1,6})(?:\s*[/-]\s*([a-z0-9]{1,6}))?/;
/** Words for a period: a number/year after them is a month or an installment, not an invoice. */
const PERIOD_WORDS = /\b(?:canone|competenza|rata|mese|mensilita|periodo|stipendio|affitto|quota)\b[^0-9]*$/;
const SEPARATOR = /^\s*(?:,|;|\+|&|\be\b|\band\b)\s*(?:n(?:r|um|o)?\b\.?\s*)?/;

function toRef(num: string, suffix: string | undefined): InvoiceRef {
  const number = Number(num);
  if (!suffix) return { number, series: null, year: null };
  if (/^20\d{2}$/.test(suffix)) return { number, series: null, year: Number(suffix) };
  if (/^\d{2}$/.test(suffix)) return { number, series: null, year: 2000 + Number(suffix) };
  return { number, series: suffix.toUpperCase(), year: null };
}

/**
 * The invoice numbers a description names: after a keyword ("FT 12/2026", "fatt. n.12",
 * "fatture 12, 13 e 14", "saldo fattura 7/A") or written as number and year ("12/2026").
 * Dates and amounts are removed first — "10/09/2026" is not invoice 9 of 2026.
 */
export function invoiceRefs(text: string | null): InvoiceRef[] {
  if (!text) return [];
  const t = fold(text)
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})\b/g, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})+,\d{2}\b|\b\d+[,.]\d{2}\b(?![/-])/g, " ");
  const out: InvoiceRef[] = [];
  const seen = new Set<string>();
  const push = (r: InvoiceRef) => {
    const k = `${r.number}|${r.series ?? ""}|${r.year ?? ""}`;
    if (r.number > 0 && !seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  };
  for (const m of t.matchAll(KEYWORD)) {
    let rest = t.slice((m.index ?? 0) + m[0].length);
    for (let item = ITEM.exec(rest); item; item = ITEM.exec(rest)) {
      push(toRef(item[1], item[2]));
      rest = rest.slice(item[0].length);
      const sep = SEPARATOR.exec(rest);
      if (!sep) break;
      rest = rest.slice(sep[0].length);
    }
  }
  // ⚠️⚠️ Number/year with no keyword is a hint: "CANONE 09/2026", "RATA 4/2026", "competenza
  // 03/2026" are periods, not invoices. A number that could be a month, or one after a word for a
  // period, is not read at all; the others are weak.
  for (const m of t.matchAll(/(?<![\d/.-])(\d{1,6})\s*\/\s*(20\d{2})\b/g)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
    // After "rif." a small number is still a reference; anywhere else it may be a month.
    const cited = /\brif(?:erimento)?\b\.?\s*(?:n(?:r|um|o)?\b\.?\s*)?$/.test(before);
    if ((Number(m[1]) <= 12 && !cited) || PERIOD_WORDS.test(before)) continue;
    const ref = toRef(m[1], m[2]);
    if (!seen.has(`${ref.number}|${ref.series ?? ""}|${ref.year ?? ""}`)) push({ ...ref, weak: true });
  }
  return out;
}

/** Whether a reference names this invoice: its number, and its series and year when stated. */
export function refNames(ref: InvoiceRef, inv: OpenInvoice): boolean {
  if (!inv.documentNumber) return false;
  const [num, series] = inv.documentNumber.split("/");
  if (Number(num) !== ref.number) return false;
  if (ref.series && ref.series !== (series ?? "").toUpperCase()) return false;
  if (ref.year && inv.issueDate && Number(inv.issueDate.slice(0, 4)) !== ref.year) return false;
  return true;
}

// ─── Names ────────────────────────────────────────────────────────────────────

// Legal forms and articles: words every other customer has too.
const STOP = new Set(
  (
    "srl srls spa snc sas ss sapa scarl scrl soc societa coop cooperativa ditta gruppo group company co " +
    "ltd llc inc gmbh ag sa sl sarl bv nv di del della dei delle e ed il lo la gli le un una the and of"
  ).split(" "),
);

export function nameTokens(s: string | null): string[] {
  if (!s) return [];
  return fold(s)
    .replace(/\b([a-z])\.(?=[a-z]\.?)/g, "$1") // s.r.l. → srl
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/**
 * Whether the payer looks like this customer: most of the customer's words in the payer's name
 * or the description. A one-word name counts only in the payer's name and only when it is not
 * short — "Italia" in a description proves nothing.
 */
export function namesMatch(
  company: readonly string[],
  payer: ReadonlySet<string>,
  described: ReadonlySet<string>,
): boolean {
  if (company.length === 0) return false;
  if (company.length === 1) return company[0].length >= 4 && payer.has(company[0]);
  const found = company.filter((w) => payer.has(w) || described.has(w)).length;
  return found / company.length >= 0.75;
}

// A queue runs every line against the same customers: their words are worked out once.
const tokenCache = new WeakMap<readonly { id: string; name: string }[], { id: string; tokens: string[] }[]>();
function companyTokens(companies: readonly { id: string; name: string }[]) {
  let cached = tokenCache.get(companies);
  if (!cached) {
    cached = companies.map((c) => ({ id: c.id, tokens: nameTokens(c.name) })).filter((c) => c.tokens.length > 0);
    tokenCache.set(companies, cached);
  }
  return cached;
}

/** Whether the line pays exactly what the invoice's next installment still owes. */
function isNextInstallment(inv: OpenInvoice, amount: number): boolean {
  return inv.nextInstallment != null && cents(inv.nextInstallment) === amount && cents(inv.outstanding) > amount;
}

// ─── Proposals ────────────────────────────────────────────────────────────────

interface Evidence {
  score: number;
  reasons: Reason[];
}

function keyOf(p: Omit<Proposal, "key" | "confidence">): string {
  return [
    `c:${p.companyId ?? ""}`,
    ...p.allocations
      .map((a) => (a.invoiceId ? `i:${a.invoiceId}:${cents(a.amount)}` : `o:${a.orderId}:${cents(a.amount)}`))
      .sort(),
    ...[...p.receiptIds].sort().map((r) => `r:${r}`),
    `cr:${cents(p.credit)}`,
  ].join("|");
}

/** Exact subsets of up to four amounts adding up to `target`, smallest first. */
function exactSubset(items: readonly { cents: number }[], target: number): number[] | null {
  const n = Math.min(items.length, SUBSET_MAX_INVOICES);
  const pick: number[] = [];
  const walk = (start: number, left: number): boolean => {
    if (left === 0) return pick.length >= 2;
    if (pick.length === SUBSET_MAX_SIZE) return false;
    for (let i = start; i < n; i++) {
      if (items[i].cents > left) continue;
      pick.push(i);
      if (walk(i + 1, left - items[i].cents)) return true;
      pick.pop();
    }
    return false;
  };
  return walk(0, target) ? [...pick] : null;
}

export function proposeMatches(tx: MatchTx, ctx: MatchContext): Proposal[] {
  const amount = cents(tx.amount);
  if (amount === 0) return [];
  const out: Omit<Proposal, "key" | "confidence">[] = [];
  const flags = new Map<number, { ambiguous?: boolean; conflict?: boolean }>();
  const add = (p: Omit<Proposal, "key" | "confidence">, f: { ambiguous?: boolean; conflict?: boolean } = {}) => {
    flags.set(out.length, f);
    out.push(p);
  };

  // Who the payer is, by IBAN and by name.
  const evidence = new Map<string, Evidence>();
  const ev = (id: string) => {
    const e = evidence.get(id) ?? { score: 0, reasons: [] };
    evidence.set(id, e);
    return e;
  };
  const payerIban = tx.counterpartyIban;
  const byIban = payerIban ? (ctx.ibans.get(payerIban) ?? []) : [];
  for (const id of byIban) {
    const e = ev(id);
    // ⚠️ Seen once, an IBAN is a hint: a holding, an accountant or a payment provider pays for
    // several customers, and one confirmation taught it for the first of them.
    const seen = payerIban ? (ctx.ibanSeen?.get(`${payerIban}|${id}`) ?? 2) : 0;
    e.score += byIban.length === 1 ? (seen >= 2 ? 40 : 25) : 15;
    e.reasons.push({ code: byIban.length === 1 ? "iban_known" : "iban_shared" });
  }
  const payer = new Set(nameTokens(tx.counterpartyName));
  const described = new Set(nameTokens(tx.remittance));
  for (const c of companyTokens(ctx.companies)) {
    if (namesMatch(c.tokens, payer, described)) {
      const e = ev(c.id);
      e.score += 25;
      e.reasons.push({ code: "payer_name" });
    }
  }
  const evidenceFor = (companyId: string | null): Evidence =>
    (companyId && evidence.get(companyId)) || { score: 0, reasons: [] };
  const otherPayer = (companyId: string | null) => byIban.length === 1 && companyId !== null && byIban[0] !== companyId;

  // ── Money in ──
  if (amount > 0) {
    // A. A receipt already written down, of the same amount, near the same day.
    const loose = ctx.receipts.filter(
      (r) =>
        r.currency === tx.currency &&
        cents(r.amount) > 0 &&
        daysApart(r.receivedOn, tx.bookedOn) <= RECEIPT_WINDOW_DAYS,
    );
    for (const r of loose.filter((r) => cents(r.amount) === amount)) {
      const days = daysApart(r.receivedOn, tx.bookedOn);
      const e = evidenceFor(r.companyId);
      add(
        {
          companyId: r.companyId,
          allocations: [],
          receiptIds: [r.id],
          credit: 0,
          score: 45 + (days <= 3 ? 10 : days <= 7 ? 5 : 0) + e.score,
          reasons: [{ code: "receipt_same_amount", count: 1 }, { code: "receipt_near", days }, ...e.reasons],
        },
        { conflict: otherPayer(r.companyId) },
      );
    }
    // Several receipts of one customer adding up to the line: one transfer paying what was typed as two.
    const looseByCompany = new Map<string, LooseReceipt[]>();
    for (const r of loose)
      if (r.companyId) looseByCompany.set(r.companyId, [...(looseByCompany.get(r.companyId) ?? []), r]);
    for (const [companyId, list] of looseByCompany) {
      const items = list.map((r) => ({ cents: cents(r.amount), r }));
      const subset = exactSubset(items, amount);
      if (!subset) continue;
      const e = evidenceFor(companyId);
      add({
        companyId,
        allocations: [],
        receiptIds: subset.map((i) => items[i].r.id),
        credit: 0,
        score: 35 + e.score,
        reasons: [{ code: "receipt_same_amount", count: subset.length }, ...e.reasons],
      });
    }

    const invoices = ctx.invoices.filter((i) => i.currency === tx.currency && cents(i.outstanding) > 0);

    // B. Invoices the description names.
    const refs = invoiceRefs(tx.remittance);
    if (refs.length > 0) {
      const named = refs.map((r) => invoices.filter((i) => refNames(r, i)));
      // Invoices only a weak reference names.
      const strong = new Set(refs.flatMap((r, k) => (r.weak ? [] : named[k].map((i) => i.id))));
      const weakOnly = new Set(named.flat().flatMap((i) => (strong.has(i.id) ? [] : [i.id])));
      const ambiguous = named.some((list) => list.length > 1);
      // One proposal per reading when a reference fits several invoices; otherwise one in all.
      const readings: OpenInvoice[][] = ambiguous
        ? named.flat().map((i) => [i])
        : [named.flatMap((list) => list.slice(0, 1))];
      for (const reading of readings) {
        const companies = new Set(reading.map((i) => i.companyId));
        if (reading.length === 0 || companies.size !== 1) continue;
        const companyId = reading[0].companyId;
        let left = amount;
        const allocations: Allocation[] = [];
        for (const inv of reading) {
          const share = Math.min(left, cents(inv.outstanding));
          if (share <= 0) break;
          allocations.push({ invoiceId: inv.id, amount: money(share) });
          left -= share;
        }
        const owed = reading.reduce((s, i) => s + cents(i.outstanding), 0);
        // One invoice paid in parts: the amount of its next installment explains the line too.
        const installment = reading.length === 1 && isNextInstallment(reading[0], amount);
        const exact = owed === amount || installment;
        const e = evidenceFor(companyId);
        const reasons: Reason[] = reading.map((i) => ({ code: "invoice_number", number: i.documentNumber ?? "" }));
        if (owed === amount) reasons.push({ code: "amount_exact" });
        else if (installment) reasons.push({ code: "installment_exact" });
        if (left > 0 && companyId) reasons.push({ code: "credit_left", amount: money(left) });
        if (left > 0 && !companyId) continue;
        if (ambiguous) reasons.push({ code: "ambiguous" });
        const conflict = otherPayer(companyId);
        if (conflict) reasons.push({ code: "other_payer" });
        add(
          {
            companyId,
            allocations,
            receiptIds: [],
            credit: money(left),
            // A reference written without "fattura" counts little: it is confirmed by the payer.
            score: (reading.every((i) => weakOnly.has(i.id)) ? 20 : 50) + (exact ? 30 : 0) + e.score,
            reasons: [...reasons, ...e.reasons],
          },
          { ambiguous, conflict },
        );
      }
    }

    // C. An order the description names: a deposit on an order not invoiced yet.
    const squeezed = fold(tx.remittance ?? "").replace(/[^a-z0-9]/g, "");
    for (const o of ctx.orders) {
      const n = fold(o.orderNumber).replace(/[^a-z0-9]/g, "");
      if (o.currency !== tx.currency || n.length < 4 || !squeezed.includes(n)) continue;
      const share = Math.min(amount, Math.max(0, cents(o.outstanding)));
      const left = amount - share;
      if (share === 0 || (left > 0 && !o.companyId)) continue;
      const e = evidenceFor(o.companyId);
      const conflict = otherPayer(o.companyId);
      add(
        {
          companyId: o.companyId,
          allocations: [{ orderId: o.id, amount: money(share) }],
          receiptIds: [],
          credit: money(left),
          score: 45 + e.score,
          reasons: [
            { code: "order_number", number: o.orderNumber },
            ...(left > 0 ? [{ code: "credit_left" as const, amount: money(left) }] : []),
            ...(conflict ? [{ code: "other_payer" as const }] : []),
            ...e.reasons,
          ],
        },
        { conflict },
      );
    }

    // D. A customer recognised by IBAN or name: what they owe.
    for (const [companyId, e] of evidence) {
      const theirs = invoices
        .filter((i) => i.companyId === companyId)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const exact = theirs.filter((i) => cents(i.outstanding) === amount || isNextInstallment(i, amount));
      if (exact.length > 0) {
        const inv = exact[0];
        const days = daysApart(inv.dueDate, tx.bookedOn);
        const whole = cents(inv.outstanding) === amount;
        add(
          {
            companyId,
            allocations: [{ invoiceId: inv.id, amount: money(amount) }],
            receiptIds: [],
            credit: 0,
            score: 30 + (days <= 10 ? 5 : 0) + e.score,
            reasons: [
              whole ? { code: "amount_exact" } : { code: "installment_exact" },
              ...(days <= 10 ? [{ code: "due_near" as const, days }] : []),
              ...(exact.length > 1 ? [{ code: "ambiguous" as const }] : []),
              ...e.reasons,
            ],
          },
          { ambiguous: exact.length > 1 },
        );
        continue;
      }
      const items = theirs.map((i) => ({ cents: cents(i.outstanding), i }));
      const subset = exactSubset(items, amount);
      if (subset) {
        add({
          companyId,
          allocations: subset.map((k) => ({ invoiceId: items[k].i.id, amount: items[k].i.outstanding })),
          receiptIds: [],
          credit: 0,
          score: 20 + e.score,
          reasons: [{ code: "amount_sum", count: subset.length }, ...e.reasons],
        });
        continue;
      }
      // Oldest first, the rest as credit; or all of it as credit when they owe nothing.
      let left = amount;
      const allocations: Allocation[] = [];
      for (const inv of theirs) {
        if (left <= 0) break;
        const share = Math.min(left, cents(inv.outstanding));
        allocations.push({ invoiceId: inv.id, amount: money(share) });
        left -= share;
      }
      add({
        companyId,
        allocations,
        receiptIds: [],
        credit: money(left),
        score: (allocations.length > 0 ? 10 : 5) + e.score,
        reasons: [
          allocations.length > 0 ? { code: "oldest_first" } : { code: "credit_only" },
          ...(allocations.length > 0 && left > 0 ? [{ code: "credit_left" as const, amount: money(left) }] : []),
          ...e.reasons,
        ],
      });
    }

    // E. Nothing says who paid: invoices owing exactly this much, anybody's.
    if (evidence.size === 0 && refs.length === 0) {
      const exact = invoices.filter((i) => cents(i.outstanding) === amount).slice(0, 5);
      for (const inv of exact)
        add(
          {
            companyId: inv.companyId,
            allocations: [{ invoiceId: inv.id, amount: money(amount) }],
            receiptIds: [],
            credit: 0,
            score: exact.length === 1 ? 25 : 15,
            reasons: [{ code: "amount_only" }, ...(exact.length > 1 ? [{ code: "ambiguous" as const }] : [])],
          },
          { ambiguous: exact.length > 1 },
        );
    }
  } else {
    // ── Money out: only a refund already written down, of the same amount. ──
    for (const r of ctx.receipts) {
      if (r.currency !== tx.currency || cents(r.amount) !== amount) continue;
      const days = daysApart(r.receivedOn, tx.bookedOn);
      if (days > RECEIPT_WINDOW_DAYS) continue;
      const e = evidenceFor(r.companyId);
      add({
        companyId: r.companyId,
        allocations: [],
        receiptIds: [r.id],
        credit: 0,
        score: 45 + (days <= 3 ? 10 : days <= 7 ? 5 : 0) + e.score,
        reasons: [{ code: "receipt_same_amount", count: 1 }, { code: "receipt_near", days }, ...e.reasons],
      });
    }
  }

  // ⚠️⚠️ A receipt already written down for this money outranks writing a new one, and makes
  // every new-receipt proposal unsure: the same transfer, typed by hand as credit, would
  // otherwise be counted again beside an invoice it did not know it paid.
  if (out.some((p) => p.receiptIds.length > 0))
    out.forEach((p, i) => {
      if (p.receiptIds.length > 0) return;
      p.score -= 30;
      p.reasons = [...p.reasons, { code: "recorded_already" }];
      flags.set(i, { ...flags.get(i), conflict: true });
    });

  // One proposal per content, the best-scored copy; best first.
  const best = new Map<
    string,
    { p: Omit<Proposal, "key" | "confidence">; f: { ambiguous?: boolean; conflict?: boolean } }
  >();
  out.forEach((p, i) => {
    const key = keyOf(p);
    const had = best.get(key);
    if (!had || had.p.score < p.score) best.set(key, { p, f: flags.get(i) ?? {} });
  });
  const ranked = [...best.entries()].sort((a, b) => b[1].p.score - a[1].p.score).slice(0, 5);
  return ranked.map(([key, { p, f }], i) => {
    const rival = ranked[i === 0 ? 1 : 0]?.[1].p.score ?? Number.NEGATIVE_INFINITY;
    const explained =
      p.credit === 0 &&
      p.allocations.reduce((s, a) => s + cents(a.amount), 0) +
        p.receiptIds.reduce((s, id) => s + cents(ctx.receipts.find((r) => r.id === id)?.amount ?? 0), 0) ===
        amount;
    const sure =
      i === 0 && p.score >= SURE_SCORE && explained && !f.ambiguous && !f.conflict && p.score - rival >= SURE_MARGIN;
    return { ...p, key, confidence: sure ? "sure" : p.score >= 45 ? "likely" : "weak" };
  });
}

/**
 * Two lines whose best proposals pay the same invoice cannot both be right: neither is `sure`.
 * Run over the whole queue after `proposeMatches`, so a bulk confirmation never pays one
 * invoice twice.
 */
export function markContested(queue: { proposals: Proposal[] }[]): void {
  const count = new Map<string, number>();
  const touched = (p: Proposal) => [
    ...p.allocations.map((a) => a.invoiceId ?? `o:${a.orderId}`),
    ...p.receiptIds.map((r) => `r:${r}`),
  ];
  for (const q of queue) {
    const top = q.proposals[0];
    if (top?.confidence === "sure") for (const t of touched(top)) count.set(t, (count.get(t) ?? 0) + 1);
  }
  for (const q of queue) {
    const top = q.proposals[0];
    if (top?.confidence === "sure" && touched(top).some((t) => (count.get(t) ?? 0) > 1)) {
      top.confidence = "likely";
      top.reasons = [...top.reasons, { code: "contested" }];
    }
  }
}

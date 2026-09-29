import type { Movement } from "./movement";
import { child, children, descendants, parseXml, textAt, type XmlNode } from "./xml-lite";

/**
 * A CAMT statement (ISO 20022), read into movements (I13).
 *
 * camt.053 is the end-of-day statement Italian banks hand out over CBI; camt.052 (intraday
 * report) and camt.054 (notification) carry the same `Ntry` and are read the same way.
 *
 * ⚠️⚠️ **An entry can be a batch.** One `Ntry` with several `TxDtls` — a bulk credit, a batch of
 * direct debits — is several payments from several people under one amount. Each detail with
 * its own amount becomes its own movement, and only when those amounts add up to the entry;
 * otherwise the entry stays one line, because a split that does not add up is a guess.
 *
 * ⚠️ Only **booked** entries are read. A pending one (`PDNG`) may never happen, and one
 * reconciled today and gone tomorrow would leave a receipt for money that never arrived.
 *
 * ⚠️ The parties are the other side: on a credit the debtor paid us, on a debit we paid the
 * creditor. Versions from 2019 on wrap the party in `Pty`; both shapes are read.
 */

export interface CamtStatement {
  /** The IBAN of the account the statement is for. */
  accountIban: string | null;
  currency: string | null;
  movements: Movement[];
  /** Entries left out, and why: not booked, or with no amount the file could state. */
  skipped: { pending: number; unreadable: number };
}

const day = (n: XmlNode | undefined): string | null => {
  const v = textAt(n, "Dt") ?? textAt(n, "DtTm");
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};

const amountOf = (n: XmlNode | undefined): { value: number; currency: string | null } | null => {
  if (!n) return null;
  const value = Number(n.text.trim());
  return Number.isFinite(value) ? { value, currency: n.attrs.Ccy ?? null } : null;
};

/** A party's name, in either shape (`Dbtr/Nm` or `Dbtr/Pty/Nm`). */
const partyName = (parties: XmlNode | undefined, role: string) =>
  textAt(parties, role, "Nm") ?? textAt(parties, role, "Pty", "Nm");

const partyIban = (parties: XmlNode | undefined, role: string) => textAt(parties, `${role}Acct`, "Id", "IBAN");

function remittanceOf(tx: XmlNode | undefined, entry: XmlNode): string | null {
  const parts: string[] = [];
  const rmt = child(tx, "RmtInf");
  for (const u of children(rmt, "Ustrd")) if (u.text.trim()) parts.push(u.text.trim());
  for (const s of children(rmt, "Strd")) {
    const ref = textAt(s, "CdtrRefInf", "Ref");
    if (ref) parts.push(ref);
    for (const r of children(s, "RfrdDocInf")) {
      const nb = textAt(r, "Nb");
      if (nb) parts.push(nb);
    }
    for (const a of children(s, "AddtlRmtInf")) if (a.text.trim()) parts.push(a.text.trim());
  }
  const extra = textAt(tx, "AddtlTxInf") ?? textAt(entry, "AddtlNtryInf");
  if (extra && !parts.includes(extra)) parts.push(extra);
  return parts.length > 0 ? parts.join(" ") : null;
}

function isBooked(entry: XmlNode): boolean {
  // `<Sts>BOOK</Sts>` up to version 8, `<Sts><Cd>BOOK</Cd></Sts>` after; absent means booked.
  const sts = child(entry, "Sts");
  if (!sts) return true;
  const code = (textAt(sts, "Cd") ?? sts.text.trim()).toUpperCase();
  return code === "" || code === "BOOK";
}

/** How an unsplittable batch says what it is, in the description the matcher and a person read. */
const BATCH_WORD = "pagamenti in lotto";

export function parseCamt(source: string): CamtStatement {
  const doc = parseXml(source.replace(/^﻿/, ""));
  const reports = [...descendants(doc, "Stmt"), ...descendants(doc, "Rpt"), ...descendants(doc, "Ntfctn")];
  if (reports.length === 0) throw new Error("camt: no statement in this file");

  const out: CamtStatement = {
    accountIban: null,
    currency: null,
    movements: [],
    skipped: { pending: 0, unreadable: 0 },
  };
  for (const report of reports) {
    const acct = child(report, "Acct");
    // ⚠️⚠️ Each movement carries its own account's IBAN: a file can hold several accounts, and
    // only the one being reconciled may be imported into it — the others were imported whole
    // into it once, and counted twice when their own statement came.
    const reportIban = textAt(acct, "Id", "IBAN");
    out.accountIban ??= reportIban;
    const acctCurrency = textAt(acct, "Ccy");
    out.currency ??= acctCurrency;

    for (const entry of children(report, "Ntry")) {
      if (!isBooked(entry)) {
        out.skipped.pending++;
        continue;
      }
      const amount = amountOf(child(entry, "Amt"));
      const bookedOn = day(child(entry, "BookgDt")) ?? day(child(entry, "ValDt"));
      if (!amount || !bookedOn) {
        out.skipped.unreadable++;
        continue;
      }
      const credit = (textAt(entry, "CdtDbtInd") ?? "CRDT").toUpperCase() === "CRDT";
      const sign = credit ? 1 : -1;
      // ⚠️ A reversal (a direct debit or RiBa returned unpaid) goes the other way from what it
      // undoes: on the debit that takes the money back, the customer is still the debtor.
      const reversal = (textAt(entry, "RvslInd") ?? "").toLowerCase() === "true";
      const valueOn = day(child(entry, "ValDt"));
      const currency = amount.currency ?? acctCurrency ?? "EUR";
      const entryRef = textAt(entry, "AcctSvcrRef");

      // An entry may carry one NtryDtls per batch (each with its `Btch` summary): all their details.
      const details = children(entry, "NtryDtls").flatMap((d) => children(d, "TxDtls"));
      const other = credit !== reversal ? "Dbtr" : "Cdtr";
      const read = (tx: XmlNode | undefined, value: number, index: number): Movement => {
        const parties = child(tx, "RltdPties");
        const refs = child(tx, "Refs");
        const e2e = textAt(refs, "EndToEndId");
        const ref =
          textAt(refs, "AcctSvcrRef") ??
          (e2e && e2e.toUpperCase() !== "NOTPROVIDED" ? e2e : null) ??
          textAt(refs, "TxId") ??
          (entryRef ? (index > 0 ? `${entryRef}/${index + 1}` : entryRef) : null);
        return {
          bookedOn,
          valueOn,
          amount: Math.round(sign * Math.abs(value) * 100) / 100,
          currency,
          counterpartyName: partyName(parties, other) ?? partyName(parties, `Ultmt${other}`),
          counterpartyIban: partyIban(parties, other),
          remittance: remittanceOf(tx, entry),
          bankReference: ref,
          accountIban: reportIban,
          ...(reversal ? { reversal: true } : {}),
        };
      };

      // A batch is split only when every detail states its amount and they add up to the entry.
      const amounts = details.map(
        (tx) => amountOf(child(tx, "AmtDtls", "TxAmt", "Amt"))?.value ?? amountOf(child(tx, "Amt"))?.value ?? null,
      );
      const splits =
        details.length > 1 &&
        amounts.every((a) => a !== null) &&
        Math.round(amounts.reduce((s: number, a) => s + Math.abs(a ?? 0), 0) * 100) ===
          Math.round(Math.abs(amount.value) * 100);
      if (splits) for (const [i, tx] of details.entries()) out.movements.push(read(tx, amounts[i] ?? 0, i));
      // ⚠️⚠️ A batch that cannot be split is several payers under one amount: it takes nothing from
      // its first detail. Given the first payer's name and IBAN, the whole amount was proposed to
      // one of them — and that IBAN learned for them.
      else if (details.length > 1)
        out.movements.push({
          ...read(undefined, amount.value, 0),
          remittance: [textAt(entry, "AddtlNtryInf"), `(${details.length} ${BATCH_WORD})`].filter(Boolean).join(" "),
        });
      else out.movements.push(read(details[0], amount.value, 0));
    }
  }
  return out;
}

/** Whether a file looks like CAMT, before trying to read it. */
export function looksLikeCamt(source: string): boolean {
  const head = source.slice(0, 2000);
  return /<(\w+:)?Document\b/.test(head) && /camt\.05[234]/.test(head);
}

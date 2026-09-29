/**
 * ⚠️⚠️ What a bank line probably is (I13): proposals with reasons, and `sure` kept narrow.
 *
 * Bulk confirmation acts on `sure` alone, so every case where a person must look — two
 * invoices owing the same, a reference and an IBAN naming different customers, credit left
 * over, a payment already typed by hand — is held here to something less than sure.
 */
import { describe, expect, it } from "vitest";

import { invoiceRefs, type MatchContext, type MatchTx, markContested, nameTokens, proposeMatches } from "./match";

const inv = (id: string, over: Partial<MatchContext["invoices"][number]> = {}) => ({
  id,
  documentNumber: id.replace("inv", ""),
  issueDate: "2026-09-01",
  dueDate: "2026-09-30",
  companyId: "glicine",
  currency: "EUR",
  outstanding: 1220,
  ...over,
});

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  invoices: [],
  orders: [],
  receipts: [],
  ibans: new Map(),
  companies: [
    { id: "glicine", name: "Ristorante Il Glicine S.r.l." },
    { id: "rossi", name: "Mario Rossi & C. snc" },
    { id: "italia", name: "Italia" },
  ],
  ...over,
});

const tx = (over: Partial<MatchTx> = {}): MatchTx => ({
  amount: 1220,
  currency: "EUR",
  bookedOn: "2026-09-28",
  counterpartyName: null,
  counterpartyIban: null,
  remittance: null,
  ...over,
});

const reasons = (p: { reasons: { code: string }[] } | undefined) => p?.reasons.map((r) => r.code);

describe("⚠️⚠️ invoice numbers in a description", () => {
  it("reads the ways people write them, and never a date or an amount", () => {
    const n = (s: string) => invoiceRefs(s).map((r) => [r.number, r.series, r.year]);
    expect(n("Saldo FT 12/2026")).toEqual([[12, null, 2026]]);
    expect(n("pagamento fatt. n.12 del 10/09/2026")).toEqual([[12, null, null]]);
    expect(n("fatture 12, 13 e 14")).toEqual([
      [12, null, null],
      [13, null, null],
      [14, null, null],
    ]);
    expect(n("saldo fattura 7/A")).toEqual([[7, "A", null]]);
    expect(n("rif. 12/2026 importo 1.220,00")).toEqual([[12, null, 2026]]);
    // "10/09/2026" is a date, not invoice 9 of 2026; "1.220,00" is an amount.
    expect(n("bonifico del 10/09/2026 di 1.220,00")).toEqual([]);
    // ⚠️⚠️ A period is not an invoice (audit, 29/09/2026).
    expect(n("CANONE 09/2026")).toEqual([]);
    expect(n("rata 4/2026 noleggio")).toEqual([]);
    expect(n("competenza 45/2026")).toEqual([]);
    // Number/year with no keyword is only a hint.
    expect(invoiceRefs("saldo 45/2026")[0]?.weak).toBe(true);
    expect(invoiceRefs("FT 45/2026")[0]?.weak).toBeUndefined();
    // A date straight after the keyword is still a date, not invoice 15 of 2009.
    expect(n("pagamento fattura 15/09/2026")).toEqual([]);
  });

  it("names a customer by its words, not by its legal form or its articles", () => {
    expect(nameTokens("Ristorante Il Glicine S.r.l.")).toEqual(["ristorante", "glicine"]);
  });
});

describe("⚠️⚠️ proposals", () => {
  it("the invoice number and the exact amount: sure", () => {
    const [best] = proposeMatches(tx({ remittance: "Saldo FT 12/2026" }), ctx({ invoices: [inv("inv12")] }));
    expect(best.allocations).toEqual([{ invoiceId: "inv12", amount: 1220 }]);
    expect(best.confidence).toBe("sure");
    expect(reasons(best)).toEqual(["invoice_number", "amount_exact"]);
  });

  it("an IBAN seen for that customer and the exact amount: sure, with the due date noted", () => {
    const [best] = proposeMatches(
      tx({ counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({ invoices: [inv("inv12")], ibans: new Map([["IT02L1234512345123456789012", ["glicine"]]]) }),
    );
    expect(best.confidence).toBe("sure");
    expect(reasons(best)).toEqual(["amount_exact", "due_near", "iban_known"]);
  });

  it("⚠️⚠️ a reference with no keyword, and nothing about the payer: never sure", () => {
    const [best] = proposeMatches(tx({ remittance: "saldo 12x 45/2026" }), ctx({ invoices: [inv("inv45")] }));
    expect(best.allocations[0].invoiceId).toBe("inv45");
    expect(best.confidence).not.toBe("sure");
  });

  it("⚠️ an IBAN seen once is a hint: with the exact amount it is not yet sure", () => {
    const iban = "IT02L1234512345123456789012";
    const once = ctx({
      invoices: [inv("inv12")],
      ibans: new Map([[iban, ["glicine"]]]),
      ibanSeen: new Map([[`${iban}|glicine`, 1]]),
    });
    expect(proposeMatches(tx({ counterpartyIban: iban }), once)[0].confidence).toBe("likely");
  });

  it("⚠️ the payer's name alone and the exact amount: likely, never sure", () => {
    const [best] = proposeMatches(
      tx({ counterpartyName: "RISTORANTE IL GLICINE SRL" }),
      ctx({ invoices: [inv("inv12")] }),
    );
    expect(best.allocations[0].invoiceId).toBe("inv12");
    expect(best.confidence).toBe("likely");
  });

  it("⚠️⚠️ two invoices owing the same: not sure, whichever looks likelier", () => {
    const [best] = proposeMatches(
      tx({ counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({
        invoices: [inv("inv12"), inv("inv13", { dueDate: "2026-10-30" })],
        ibans: new Map([["IT02L1234512345123456789012", ["glicine"]]]),
      }),
    );
    expect(best.allocations[0].invoiceId).toBe("inv12");
    expect(best.confidence).not.toBe("sure");
    expect(reasons(best)).toContain("ambiguous");
  });

  it("⚠️⚠️ the reference names one customer and the IBAN another: a person decides", () => {
    const proposals = proposeMatches(
      tx({ remittance: "FT 12/2026", counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({ invoices: [inv("inv12")], ibans: new Map([["IT02L1234512345123456789012", ["rossi"]]]) }),
    );
    const byRef = proposals.find((p) => p.allocations[0]?.invoiceId === "inv12");
    expect(reasons(byRef)).toContain("other_payer");
    expect(proposals.some((p) => p.confidence === "sure")).toBe(false);
  });

  it("⚠️⚠️ money already typed by hand is linked, never received twice", () => {
    const proposals = proposeMatches(
      tx({ remittance: "Saldo FT 12/2026" }),
      ctx({
        invoices: [inv("inv12", { outstanding: 0 })],
        receipts: [{ id: "r1", companyId: "glicine", amount: 1220, currency: "EUR", receivedOn: "2026-09-27" }],
      }),
    );
    // The invoice owes nothing any more — the hand-typed receipt paid it — so the only
    // proposal is the link.
    expect(proposals[0].receiptIds).toEqual(["r1"]);
    expect(proposals[0].allocations).toEqual([]);
    expect(proposals.every((p) => p.allocations.length === 0)).toBe(true);
  });

  it("⚠️⚠️ money typed by hand as credit comes first, even beside an open invoice it pays", () => {
    const proposals = proposeMatches(
      tx({ remittance: "Saldo FT 12/2026" }),
      ctx({
        invoices: [inv("inv12")],
        receipts: [{ id: "r1", companyId: "glicine", amount: 1220, currency: "EUR", receivedOn: "2026-09-26" }],
      }),
    );
    expect(proposals[0].receiptIds).toEqual(["r1"]);
    const fresh = proposals.find((p) => p.allocations[0]?.invoiceId === "inv12");
    expect(fresh?.confidence).not.toBe("sure");
    expect(reasons(fresh)).toContain("recorded_already");
  });

  it("a hand-typed receipt, the payer's IBAN and the same day: sure", () => {
    const [best] = proposeMatches(
      tx({ counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({
        receipts: [{ id: "r1", companyId: "glicine", amount: 1220, currency: "EUR", receivedOn: "2026-09-27" }],
        ibans: new Map([["IT02L1234512345123456789012", ["glicine"]]]),
      }),
    );
    expect(best.receiptIds).toEqual(["r1"]);
    expect(best.confidence).toBe("sure");
  });

  it("one transfer paying several invoices of one customer, found by the exact sum", () => {
    const [best] = proposeMatches(
      tx({ amount: 700, counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({
        invoices: [
          inv("inv1", { outstanding: 500, dueDate: "2026-08-01" }),
          inv("inv2", { outstanding: 450, dueDate: "2026-08-15" }),
          inv("inv3", { outstanding: 200, dueDate: "2026-09-01" }),
        ],
        ibans: new Map([["IT02L1234512345123456789012", ["glicine"]]]),
      }),
    );
    expect(best.allocations.map((a) => a.invoiceId).sort()).toEqual(["inv1", "inv3"]);
    expect(reasons(best)).toContain("amount_sum");
  });

  it("⚠️ more than they owe: the rest is their credit, and that is never sure", () => {
    const [best] = proposeMatches(tx({ amount: 1500, remittance: "FT 12/2026" }), ctx({ invoices: [inv("inv12")] }));
    expect(best.allocations).toEqual([{ invoiceId: "inv12", amount: 1220 }]);
    expect(best.credit).toBe(280);
    expect(best.confidence).not.toBe("sure");
  });

  it("⚠️⚠️ however strong the signals, credit left over is never sure", () => {
    const [best] = proposeMatches(
      tx({ amount: 1500, remittance: "FT 12/2026", counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({ invoices: [inv("inv12")], ibans: new Map([["IT02L1234512345123456789012", ["glicine"]]]) }),
    );
    expect(best.score).toBeGreaterThanOrEqual(70);
    expect(best.credit).toBe(280);
    expect(best.confidence).toBe("likely");
  });

  it("⚠️ paid in installments: the next installment's amount is as good as the whole balance", () => {
    const [best] = proposeMatches(
      tx({ amount: 366, counterpartyIban: "IT02L1234512345123456789012" }),
      ctx({
        invoices: [inv("inv12", { outstanding: 1220, nextInstallment: 366, dueDate: "2026-09-29" })],
        ibans: new Map([["IT02L1234512345123456789012", ["glicine"]]]),
      }),
    );
    expect(best.allocations).toEqual([{ invoiceId: "inv12", amount: 366 }]);
    expect(best.confidence).toBe("sure");
    expect(reasons(best)).toContain("installment_exact");
  });

  it("an order named in the description: a deposit on it", () => {
    const [best] = proposeMatches(
      tx({ amount: 500, remittance: "Acconto ordine ORD-2026-008" }),
      ctx({
        orders: [{ id: "o8", orderNumber: "ORD-2026-008", companyId: "glicine", currency: "EUR", outstanding: 1384.7 }],
      }),
    );
    expect(best.allocations).toEqual([{ orderId: "o8", amount: 500 }]);
  });

  it("⚠️ nothing says who paid: an invoice owing exactly that is weak, and several are ambiguous", () => {
    const one = proposeMatches(tx(), ctx({ invoices: [inv("inv12")] }));
    expect(one[0].confidence).toBe("weak");
    const two = proposeMatches(tx(), ctx({ invoices: [inv("inv12"), inv("inv99", { companyId: "rossi" })] }));
    expect(two.every((p) => p.confidence === "weak")).toBe(true);
  });

  it("⚠️ another currency is never proposed", () => {
    expect(
      proposeMatches(tx({ remittance: "FT 12/2026", currency: "USD" }), ctx({ invoices: [inv("inv12")] })),
    ).toEqual([]);
  });

  it("⚠️ a one-word customer is recognised only in the payer's name", () => {
    expect(proposeMatches(tx({ remittance: "bonifico sepa italia" }), ctx()).length).toBe(0);
    expect(proposeMatches(tx({ counterpartyName: "ITALIA" }), ctx())[0]?.companyId).toBe("italia");
  });

  it("money out: only a refund already written down", () => {
    const [best] = proposeMatches(
      tx({ amount: -80 }),
      ctx({ receipts: [{ id: "ref", companyId: "glicine", amount: -80, currency: "EUR", receivedOn: "2026-09-28" }] }),
    );
    expect(best.receiptIds).toEqual(["ref"]);
    expect(proposeMatches(tx({ amount: -80 }), ctx())).toEqual([]);
  });
});

describe("⚠️⚠️ the queue as a whole", () => {
  it("two lines sure of the same invoice are neither of them sure", () => {
    const c = ctx({ invoices: [inv("inv12")] });
    const queue = [
      { proposals: proposeMatches(tx({ remittance: "FT 12/2026" }), c) },
      { proposals: proposeMatches(tx({ remittance: "saldo fattura 12/2026" }), c) },
    ];
    expect(queue.map((q) => q.proposals[0].confidence)).toEqual(["sure", "sure"]);
    markContested(queue);
    expect(queue.map((q) => q.proposals[0].confidence)).toEqual(["likely", "likely"]);
    expect(reasons(queue[0].proposals[0])).toContain("contested");
  });
});

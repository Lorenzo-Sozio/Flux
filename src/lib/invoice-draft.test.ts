/**
 * Draft invoices: made from an order, edited, dated.
 */
import { describe, expect, it } from "vitest";

import { cleanDraft, customerSnapshot, italianToday, linesFromOrder } from "./invoice-draft";

describe("lines from an order", () => {
  it("⚠️ takes the order line's description, then the product's name, never nothing", () => {
    const lines = linesFromOrder([
      {
        productId: "p1",
        description: "Montaggio su misura",
        productName: "Scaffale",
        quantity: 2,
        unitPrice: "50.00",
        discountPercent: "10",
        taxPercent: "22",
      },
      {
        productId: "p2",
        description: null,
        productName: "Scaffale",
        quantity: 1,
        unitPrice: "80",
        discountPercent: null,
        taxPercent: null,
      },
    ]);
    expect(lines).toEqual([
      {
        productId: "p1",
        description: "Montaggio su misura",
        quantity: 2,
        unitPrice: 50,
        discountPercent: 10,
        taxPercent: 22,
        nature: null,
      },
      {
        productId: "p2",
        description: "Scaffale",
        quantity: 1,
        unitPrice: 80,
        discountPercent: 0,
        taxPercent: 0,
        nature: null,
      },
    ]);
  });
});

const draft = {
  series: "",
  dueDate: "2026-10-15",
  discountPercent: 0,
  stampDutyMode: "auto",
  stampDutyNote: "left over",
  paymentMethod: "MP05",
  notes: "",
  lines: [{ description: " Consulenza ", quantity: 1.23456, unitPrice: 99.999, taxPercent: 22 }],
};

describe("saving a draft", () => {
  it("⚠️ drops a stamp duty reason once the invoice is back on automatic", () => {
    const r = cleanDraft(draft);
    expect(r.ok && r.value.stampDutyNote).toBeNull();
    const forced = cleanDraft({ ...draft, stampDutyMode: "force_off", stampDutyNote: " Esenzione ONLUS " });
    expect(forced.ok && forced.value.stampDutyNote).toBe("Esenzione ONLUS");
    expect(cleanDraft({ ...draft, stampDutyMode: "sometimes" }).ok).toBe(false);
  });

  it("rounds to what the XML carries and trims text", () => {
    const r = cleanDraft(draft);
    expect(r.ok && r.value.lines[0]).toMatchObject({ description: "Consulenza", quantity: 1.235, unitPrice: 100 });
    expect(r.ok && r.value.notes).toBeNull();
  });

  it("⚠️ keeps a Natura code on a taxed line as typed, for the issue check to name", () => {
    const r = cleanDraft({ ...draft, lines: [{ ...draft.lines[0], nature: "N4" }] });
    expect(r.ok && r.value.lines[0].nature).toBe("N4");
  });

  it("refuses an unknown Natura code, payment method, series or date", () => {
    expect(cleanDraft({ ...draft, lines: [{ ...draft.lines[0], nature: "N9" }] }).ok).toBe(false);
    expect(cleanDraft({ ...draft, paymentMethod: "MP99" }).ok).toBe(false);
    expect(cleanDraft({ ...draft, series: "A/B" }).ok).toBe(false);
    expect(cleanDraft({ ...draft, dueDate: "2026-02-30" }).ok).toBe(false);
  });

  it("refuses a negative price, quantity, a discount over 100% and a VAT rate over 100%", () => {
    expect(cleanDraft({ ...draft, lines: [{ ...draft.lines[0], unitPrice: -1 }] }).ok).toBe(false);
    expect(cleanDraft({ ...draft, lines: [{ ...draft.lines[0], quantity: -1 }] }).ok).toBe(false);
    expect(cleanDraft({ ...draft, discountPercent: 101 }).ok).toBe(false);
    expect(cleanDraft({ ...draft, lines: [{ ...draft.lines[0], taxPercent: 122 }] }).ok).toBe(false);
  });
});

describe("the issue date", () => {
  it("⚠️⚠️ is the Italian calendar day, so the first invoice of the year gets the new year", () => {
    // 23:30 UTC on 31 December is 00:30 on 1 January in Rome.
    expect(italianToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(italianToday(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
    expect(italianToday(new Date("2026-07-01T22:01:00Z"))).toBe("2026-07-02");
  });
});

describe("the customer as frozen on the invoice", () => {
  it("⚠️ stores identifiers in the form FatturaPA wants", () => {
    expect(
      customerSnapshot({
        name: "Cliente S.p.A.",
        vatNumber: "IT 00488410010",
        fiscalCode: " rssmra85t10a562s ",
        sdiCode: "m5uxcr1",
        pec: " Fatture@PEC.it ",
        street: "Corso Italia 10",
        zipCode: "10121",
        city: "Torino",
        state: "to",
        country: "IT",
      }),
    ).toMatchObject({
      vatNumber: "00488410010",
      fiscalCode: "RSSMRA85T10A562S",
      sdiCode: "M5UXCR1",
      pec: "fatture@pec.it",
      province: "TO",
    });
  });
});

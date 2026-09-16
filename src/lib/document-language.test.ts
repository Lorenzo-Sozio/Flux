/**
 * The language and the figures a customer's documents are written in.
 *
 * ⚠️⚠️ Everything here fails silently on screen: an English word in an Italian
 * PDF, a dollar sign on a euro quote, a date a day early. The customer is the one
 * who notices.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  documentLanguage,
  fill,
  formatDocumentDate,
  formatDocumentMoney,
  INVOICE_TEXT,
  PAYMENT_METHOD_TEXT,
  QUOTE_TEXT,
  quoteStatusText,
} from "./document-language";

/** Every key path of an object, nested ones included. */
function paths(o: object, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? paths(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("which language", () => {
  it("⚠️⚠️ the customer's own choice wins over their country", () => {
    expect(documentLanguage({ language: "en", country: "Italia" })).toBe("en");
    expect(documentLanguage({ language: "it", country: "Germany" })).toBe("it");
  });

  it("⚠️ without a choice, an Italian address or none is Italian, anything else English", () => {
    for (const country of ["IT", "Italia", " italy ", "", null, undefined]) {
      expect(documentLanguage({ country }), String(country)).toBe("it");
    }
    for (const country of ["DE", "Germany", "France", "United Kingdom"]) {
      expect(documentLanguage({ country }), country).toBe("en");
    }
    expect(documentLanguage(null)).toBe("it");
  });

  it("⚠️ an unknown stored value falls back to the country instead of breaking the lookup", () => {
    expect(documentLanguage({ language: "fr", country: "DE" })).toBe("en");
    expect(documentLanguage({ language: "", country: "IT" })).toBe("it");
  });
});

describe("the texts", () => {
  it("⚠️⚠️ every quote text exists in both languages", () => {
    expect(paths(QUOTE_TEXT.en).sort()).toEqual(paths(QUOTE_TEXT.it).sort());
  });

  it("⚠️⚠️ every invoice text and payment method exists in both languages", () => {
    expect(paths(INVOICE_TEXT.en).sort()).toEqual(paths(INVOICE_TEXT.it).sort());
    expect(Object.keys(PAYMENT_METHOD_TEXT.en).sort()).toEqual(Object.keys(PAYMENT_METHOD_TEXT.it).sort());
  });

  it("⚠️ the two languages actually differ, so a copy-paste of one into the other is caught", () => {
    expect(QUOTE_TEXT.it.documentTitle).toBe("Preventivo");
    expect(QUOTE_TEXT.en.documentTitle).toBe("Quote");
    expect(INVOICE_TEXT.it.invoice).toBe("Fattura");
    expect(INVOICE_TEXT.en.invoice).toBe("Invoice");
  });

  it("⚠️ the English courtesy copy keeps the Italian legal wording beside its translation", () => {
    expect(INVOICE_TEXT.en.courtesyNotice).toContain("copia di cortesia priva di valore fiscale");
    expect(INVOICE_TEXT.en.courtesyNotice).toContain("633/1972");
  });

  it("names statuses in the customer's language, and shows an unknown one as stored", () => {
    expect(quoteStatusText("accepted", "it")).toBe("Accettato");
    expect(quoteStatusText("accepted", "en")).toBe("Accepted");
    expect(quoteStatusText("something_new", "it")).toBe("something_new");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fill("Preventivo {number} per {missing}", { number: "Q-1" })).toBe("Preventivo Q-1 per {missing}");
  });
});

describe("the figures", () => {
  // Intl separates the symbol with a no-break space; the test reads it as a plain one.
  const plain = (v: string) => v.replace(/[\u00a0\u202f]/g, " ");

  it("⚠️⚠️ keeps the document's currency and never converts the amount", () => {
    expect(plain(formatDocumentMoney(1234.5, "EUR", "it"))).toBe("1.234,50 €");
    expect(plain(formatDocumentMoney("1234.5", "EUR", "en"))).toBe("€1,234.50");
    expect(plain(formatDocumentMoney(1234.5, "USD", "it"))).toBe("1.234,50 USD");
    expect(plain(formatDocumentMoney(1234.5, "USD", "en"))).toBe("US$1,234.50");
  });

  it("⚠️ groups thousands in Italian too, where Intl would not for four digits", () => {
    expect(plain(formatDocumentMoney(1020, "EUR", "it"))).toBe("1.020,00 €");
  });

  it("⚠️ a calendar date stays on its day whatever the server's time zone", () => {
    expect(formatDocumentDate("2026-01-01", "it")).toBe("1 gennaio 2026");
    expect(formatDocumentDate("2026-12-31", "en")).toBe("31 December 2026");
    expect(formatDocumentDate(null, "it")).toBe("—");
  });
});

describe("where the customer's language reaches", () => {
  const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

  it("⚠️⚠️ the quote PDF, its print view, the public page and the email all take it", () => {
    expect(read("src/app/api/quotes/[id]/pdf/route.ts")).toContain("documentLanguage(q.company)");
    expect(read("src/app/api/quotes/[id]/route.ts")).toContain("documentLanguage(q.company)");
    expect(read("src/app/api/quotes/public/route.ts")).toContain("language: documentLanguage(quote.company)");
    expect(read("src/actions/quotes.ts")).toContain("const lang = documentLanguage(quote.company);");
  });

  it("⚠️⚠️ the public quote API sends only the company fields the page shows", () => {
    const src = read("src/app/api/quotes/public/route.ts");
    expect(src, "the whole company record is sent again").not.toMatch(/^\s*company: true,/m);
    expect(src).toContain("company: { columns: { name: true, country: true, language: true, vatNumber: true } }");
  });

  it("⚠️⚠️ the email links to the quote's real public token", () => {
    const src = read("src/actions/quotes.ts");
    expect(src).toContain("appUrl(`/q/${quote.publicToken}`)");
    expect(src).not.toContain("viewToken");
  });

  it("⚠️ the invoice snapshot freezes the language with the customer", () => {
    expect(read("src/lib/invoice-draft.ts")).toContain("language: documentLanguage(c),");
  });
});

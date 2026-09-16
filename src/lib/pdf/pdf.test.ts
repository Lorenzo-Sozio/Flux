/**
 * The PDFs a customer receives, rendered for real.
 *
 * ⚠️⚠️ The previous renderer passed every test and answered 500 on every request in
 * production: it compiled WebAssembly at runtime, which Workers forbid. These tests
 * cannot see a Worker either, so they guard what this one could get wrong instead —
 * a character the standard fonts cannot encode failing the whole document, lines
 * running off the page, the table losing its header on page two.
 */
import { readFileSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { createCanvas } from "./canvas";
import { renderQuotePdf } from "./quote-pdf";

const seller = { name: "Esempio S.r.l.", vatNumber: "00905811006", address: "Via Roma 1", email: null, phone: null };

function quote(items: number, description = "Consulenza") {
  return {
    quoteNumber: "Q-2026-0001",
    status: "sent",
    currency: "EUR",
    subtotal: "100",
    discountAmount: "0",
    discountPercent: "0",
    taxAmount: "22",
    taxPercent: "0",
    totalAmount: "122",
    notes: null,
    issuedAt: "2026-09-16T10:00:00Z",
    expiresAt: null,
    company: {
      name: "Cliente S.p.A.",
      street: null,
      zipCode: null,
      city: null,
      state: null,
      country: "IT",
      vatNumber: null,
    },
    contact: null,
    owner: null,
    items: Array.from({ length: items }, (_, i) => ({
      description: `${description} ${i + 1}`,
      quantity: 1,
      unitPrice: "100",
      discountPercent: "0",
      taxPercent: "22",
      totalPrice: "100",
      product: null,
    })),
  };
}

describe("the quote PDF", () => {
  it("⚠️⚠️ renders text the standard fonts cannot encode instead of failing the document", async () => {
    const bytes = await renderQuotePdf({
      quote: { ...quote(1, "Prezzo − sconto 😀 1 000 € ✓ 中文"), notes: "Note con spazio stretto e →" },
      seller: { ...seller, name: "Ditta 🚀 S.r.l." },
      lang: "it",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("⚠️ breaks onto a new page instead of drawing lines below the footer", async () => {
    const one = await PDFDocument.load(await renderQuotePdf({ quote: quote(5), seller, lang: "en" }));
    const many = await PDFDocument.load(await renderQuotePdf({ quote: quote(60), seller, lang: "en" }));
    expect(one.getPageCount()).toBe(1);
    expect(many.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it("⚠️ a single word wider than the column is cut, not left to overflow", async () => {
    const c = await createCanvas({ title: "t", marginX: 40, marginTop: 40, marginBottom: 40 });
    const lines = c.wrap(`Codice ${"A".repeat(400)} fine`, 120, { size: 10 });
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(c.width(l, { size: 10 }), l).toBeLessThanOrEqual(120);
    expect(lines.join("").replace(/\s/g, "")).toBe(`Codice${"A".repeat(400)}fine`);
  });

  it("records the title and language of the document", async () => {
    const doc = await PDFDocument.load(await renderQuotePdf({ quote: quote(1), seller, lang: "en" }), {
      updateMetadata: false,
    });
    expect(doc.getTitle()).toBe("Quote Q-2026-0001");
    expect(doc.getAuthor()).toBe("Esempio S.r.l.");
  });
});

describe("no WebAssembly in the PDF path", () => {
  it("⚠️⚠️ nothing imports @react-pdf, whose layout engine cannot run on Workers", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["@react-pdf/renderer"], "@react-pdf/renderer is back in the dependencies").toBeUndefined();
    for (const file of ["src/lib/invoice-archive.ts", "src/app/api/quotes/[id]/pdf/route.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("@react-pdf");
    }
  });
});

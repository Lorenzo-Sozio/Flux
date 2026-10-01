/**
 * The look of every email to a customer (src/lib/email-brand.ts): the frame, the signature, the
 * boxes a document puts before the text — and the one thing that must never slip, which is that
 * whatever a person typed reaches the inbox escaped.
 */
import { describe, expect, it } from "vitest";

import {
  brandFrame,
  brandText,
  cleanBrandIdentity,
  cleanColor,
  cleanSignatureSettings,
  cleanUrl,
  ctaButton,
  type EmailBrand,
  ibanBox,
  initialsOf,
  inkOn,
  personalEmail,
  placesSignature,
  type SignaturePerson,
  signatureHtml,
  summaryBox,
} from "./email-brand";

const brand: EmailBrand = {
  name: "Esempio Impianti S.r.l.",
  color: "#0f766e",
  logoUrl: "https://crm.example.it/api/brand/logo/abc.def?v=1",
  website: "https://www.esempioimpianti.it/",
  socials: [{ kind: "linkedin", url: "https://www.linkedin.com/company/esempio" }],
  address: "Via dei Mille 24, 20121 Milano (MI)",
  vatNumber: "IT01234567890",
  phone: "+39 02 1234 5678",
  email: "info@esempioimpianti.it",
};

const person: SignaturePerson = {
  name: "Giulia Ferri",
  email: "giulia@esempioimpianti.it",
  title: "Responsabile commerciale",
  phone: null,
  mobile: "+39 333 123 4567",
  photoUrl: null,
};

describe("⚠️⚠️ what a person typed reaches the inbox escaped", () => {
  it("a name, a role and a company name cannot write markup into the signature", () => {
    const html = signatureHtml({
      person: { ...person, name: 'Mario "><img src=x onerror=alert(1)>', title: "<script>x</script>" },
      brand: { ...brand, name: "A&B <b>Srl</b>" },
      variant: "full",
      lang: "it",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Srl</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
  });

  it("the frame's label and preheader are text, not markup", () => {
    const html = brandFrame({ brand, lang: "it", label: "<i>x</i>", preheader: "<u>y</u>", body: "<p>ok</p>" });
    expect(html).not.toContain("<i>x</i>");
    expect(html).not.toContain("<u>y</u>");
    // The body is the email's own HTML, already composed: it goes in as it is.
    expect(html).toContain("<p>ok</p>");
  });

  it("a summary's figures are escaped too", () => {
    const html = summaryBox({ highlight: { label: "Totale", value: "<b>1</b>" }, rows: [["<x>", "<y>"]] });
    expect(html).not.toMatch(/<b>1<\/b>|<x>|<y>/);
  });
});

describe("⚠️⚠️ links are http(s), colours are hex", () => {
  it("refuses javascript:, data: and anything without a host", () => {
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("data:text/html,<script>")).toBeNull();
    expect(cleanUrl("JaVaScRiPt:alert(1)")).toBeNull();
    // A host does not make it a web address: only the scheme stops this one.
    expect(cleanUrl("javascript://example.com/%0Aalert(1)")).toBeNull();
    expect(cleanUrl("ftp://example.com/file")).toBeNull();
    expect(cleanUrl("localhost")).toBeNull();
    expect(cleanUrl("https://exa mple.com")).toBeNull();
    expect(cleanUrl("")).toBeNull();
  });

  it("reads a bare address as https", () => {
    expect(cleanUrl("www.example.com")).toBe("https://www.example.com/");
    expect(cleanUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("keeps a colour only as #rrggbb, widening #rgb", () => {
    expect(cleanColor("#ABC")).toBe("#aabbcc");
    expect(cleanColor("#0f766e")).toBe("#0f766e");
    expect(cleanColor("red; background:url(x)")).toBeNull();
    expect(cleanColor("#12345")).toBeNull();
  });

  it("a stored identity drops what cannot be used, rather than storing it", () => {
    const clean = cleanBrandIdentity({
      color: "expression(alert(1))",
      website: "javascript:alert(1)",
      socials: { linkedin: "linkedin.com/company/x", instagram: "javascript:x", tiktok: "https://tiktok.com/x" },
    });
    expect(clean.color).toBe("#1d4ed8");
    expect(clean.website).toBeNull();
    expect(clean.socials).toEqual({ linkedin: "https://linkedin.com/company/x" });
  });

  it("a social link that is not http(s) is never written into the signature", () => {
    const html = signatureHtml({
      person,
      brand: { ...brand, socials: [{ kind: "x", url: "https://x.com/esempio" }] },
      variant: "full",
      lang: "it",
    });
    expect(html).toContain('href="https://x.com/esempio"');
  });

  it("a button to a link that is not http(s) is not drawn at all", () => {
    expect(ctaButton(brand, "Apri", "javascript:alert(1)")).toBe("");
    expect(ctaButton(brand, "Apri", "https://crm.example.it/q/tok")).toContain('href="https://crm.example.it/q/tok"');
  });
});

describe("⚠️ a colour that is light still reads", () => {
  it("dark text on a light brand colour, white on a dark one", () => {
    expect(inkOn("#fde047")).not.toBe("#ffffff");
    expect(inkOn("#1d4ed8")).toBe("#ffffff");
  });

  it("a light brand colour is not used as text on white", () => {
    expect(brandText("#fde047")).not.toBe("#fde047");
    expect(brandText("#1d4ed8")).toBe("#1d4ed8");
  });
});

describe("the signature", () => {
  it("full: name, role · company, the phones as links, the site, the logo, the socials, the legal line", () => {
    const html = signatureHtml({ person, brand, variant: "full", lang: "it" });
    expect(html).toContain("Giulia Ferri");
    expect(html).toContain("Responsabile commerciale · Esempio Impianti S.r.l.");
    expect(html).toContain('href="tel:+393331234567"');
    // No phone of their own: the company's.
    expect(html).toContain('href="tel:+390212345678"');
    expect(html).toContain('href="mailto:giulia@esempioimpianti.it"');
    expect(html).toContain("esempioimpianti.it<");
    expect(html).toContain(`src="${brand.logoUrl}"`);
    expect(html).toContain("LinkedIn");
    expect(html).toContain("P.IVA IT01234567890");
  });

  it("the legal line follows the customer's language", () => {
    expect(signatureHtml({ person, brand, variant: "full", lang: "en" })).toContain("VAT IT01234567890");
  });

  it("initials when there is no photo, the photo when they chose it", () => {
    expect(signatureHtml({ person, brand, variant: "full", lang: "it" })).toContain(">GF<");
    const withPhoto = signatureHtml({
      person: { ...person, photoUrl: "https://lh3.googleusercontent.com/a/x" },
      brand,
      variant: "full",
      lang: "it",
    });
    expect(withPhoto).toContain('src="https://lh3.googleusercontent.com/a/x"');
    expect(withPhoto).not.toContain(">GF<");
  });

  it("compact: one line of who, one of how to reach them", () => {
    const html = signatureHtml({ person, brand, variant: "compact", lang: "it" });
    expect(html).toContain("Giulia Ferri");
    expect(html).toContain("+39 333 123 4567");
    expect(html).not.toContain("P.IVA");
  });

  it("initials from the first and last name, whatever the spacing", () => {
    expect(initialsOf("  anna  maria   rossi ")).toBe("AR");
    expect(initialsOf("Luca")).toBe("L");
  });

  it("settings: on unless switched off, and typed text trimmed", () => {
    expect(cleanSignatureSettings({}).enabled).toBe(true);
    expect(cleanSignatureSettings({ enabled: false }).enabled).toBe(false);
    expect(cleanSignatureSettings({ title: "  Sales   lead ", usePhoto: "yes" })).toMatchObject({
      title: "Sales lead",
      usePhoto: false,
    });
  });
});

describe("the frame", () => {
  it("carries the logo, the label, a hidden preheader and the company's details", () => {
    const html = brandFrame({ brand, lang: "it", label: "Preventivo 7", preheader: "Valido fino al 31", body: "x" });
    expect(html).toContain(`src="${brand.logoUrl}"`);
    expect(html).toContain("Preventivo 7");
    expect(html).toMatch(/display:none[^>]*>Valido fino al 31/);
    expect(html).toContain("Via dei Mille 24");
    expect(html).toContain(brand.color);
  });

  it("without a logo, the name stands in as a wordmark", () => {
    const html = brandFrame({ brand: { ...brand, logoUrl: null }, lang: "it", body: "x" });
    expect(html).not.toContain("<img");
    expect(html).toContain("Esempio Impianti S.r.l.</span>");
  });

  it("an IBAN in groups of four, with payee and reference", () => {
    const html = ibanBox({ iban: "it60x0542811101000000123456", payee: "Esempio", reference: "Fattura 7", lang: "it" });
    expect(html).toContain("IT60 X054 2811 1010 0000 0123 456");
    expect(html).toContain("causale: Fattura 7");
  });

  it("a reminder's box is amber, not red", () => {
    const html = summaryBox({ tone: "warning", highlight: { label: "Scaduta da 3 giorni", value: "€ 10" }, rows: [] });
    expect(html).toContain("#fff7ed");
    expect(html).not.toMatch(/#dc2626|#ef4444/);
  });
});

describe("⚠️ a signature the author placed is not added twice", () => {
  it("recognises {{firma}} and {{signature}}, spaced or not", () => {
    expect(placesSignature("<p>Ciao</p>{{firma}}")).toBe(true);
    expect(placesSignature("{{ signature }}")).toBe(true);
    expect(placesSignature("<p>la mia firma</p>")).toBe(false);
  });

  it("a personal email is the text, then the signature", () => {
    expect(personalEmail("<p>Ciao</p>", "SIG")).toMatch(/^<p>Ciao<\/p>.*SIG/);
    expect(personalEmail("<p>Ciao</p>", "")).toBe("<p>Ciao</p>");
  });
});

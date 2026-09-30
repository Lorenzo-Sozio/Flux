/**
 * Placeholders and the unsubscribe link.
 *
 * On the tested surface because both failures are silent and land outside the
 * product. A placeholder that does not resolve is read by a customer; a campaign
 * with no way out is unlawful, and the send reports success either way.
 */
import { describe, expect, it } from "vitest";

import {
  documentValues,
  ensureUnsubscribe,
  findUnknownPlaceholders,
  hasUnsubscribePlaceholder,
  PLACEHOLDERS,
  pendingFields,
  renderPlaceholders,
  valuesForRecipient,
} from "./email-placeholders";

const values = valuesForRecipient({
  firstName: "Giulia",
  lastName: "Rossi",
  email: "g@example.com",
  company: "Acme",
});

describe("renderPlaceholders", () => {
  it("resolves the Italian and the English spelling to the same value", () => {
    expect(renderPlaceholders("Ciao {{nome}}", values)).toBe("Ciao Giulia");
    expect(renderPlaceholders("Hi {{firstName}}", values)).toBe("Hi Giulia");
    expect(renderPlaceholders("Hi {{first_name}}", values)).toBe("Hi Giulia");
  });

  it("tolerates the spaces people leave inside the braces", () => {
    expect(renderPlaceholders("Hi {{ nome }}", values)).toBe("Hi Giulia");
  });

  it("leaves a placeholder nothing can fill exactly as written", () => {
    // Blanking it would hide the mistake until a customer read the gap.
    expect(renderPlaceholders("Hi {{oggetto}}", values)).toBe("Hi {{oggetto}}");
  });

  it("writes an empty string for a known field the record does not have", () => {
    expect(renderPlaceholders("Hi {{ruolo}}!", values)).toBe("Hi !");
  });

  it("substitutes every occurrence, not only the first", () => {
    expect(renderPlaceholders("{{nome}} {{nome}}", values)).toBe("Giulia Giulia");
  });

  it("builds a full name without a double space when a half is missing", () => {
    const half = valuesForRecipient({ firstName: "Giulia", lastName: null });
    expect(renderPlaceholders("{{fullName}}", half)).toBe("Giulia");
  });

  it("substitutes the company, which the editor offered and nothing ever filled", () => {
    expect(renderPlaceholders("at {{azienda}}", values)).toBe("at Acme");
  });
});

describe("findUnknownPlaceholders", () => {
  it("names what will not resolve", () => {
    expect(findUnknownPlaceholders("Hi {{nome}}, about {{oggetto}} and {{prezzo}}")).toEqual(["oggetto", "prezzo"]);
  });

  it("says nothing when everything resolves", () => {
    expect(findUnknownPlaceholders("Hi {{nome}} {{cognome}}")).toEqual([]);
  });

  it("reports each unknown once however often it appears", () => {
    expect(findUnknownPlaceholders("{{x}} {{x}} {{x}}")).toEqual(["x"]);
  });
});

describe("ensureUnsubscribe", () => {
  const url = "https://crm.example/unsub?token=abc";

  it("fills the link the author placed", () => {
    const out = ensureUnsubscribe('<a href="{{link_unsubscribe}}">Out</a>', url);
    expect(out).toContain(url);
    expect(out).not.toContain("{{");
  });

  it("adds one when the author left it out", () => {
    const out = ensureUnsubscribe("<p>Buy things</p>", url);
    expect(out).toContain(url);
    expect(out.toLowerCase()).toContain("unsubscribe");
  });

  it("puts the added link inside the body, not after it", () => {
    const out = ensureUnsubscribe("<html><body><p>Hi</p></body></html>", url);
    expect(out.indexOf(url)).toBeLessThan(out.indexOf("</body>"));
  });

  it("recognises every spelling of the link, so it never adds a second one", () => {
    const unsubscribe = PLACEHOLDERS.find((p) => p.key === "unsubscribe");
    expect(unsubscribe).toBeDefined();
    for (const alias of unsubscribe?.aliases ?? []) {
      const out = ensureUnsubscribe(`<a href="{{${alias}}}">x</a>`, url);
      expect(out.split(url).length - 1, alias).toBe(1);
    }
  });
});

describe("hasUnsubscribePlaceholder", () => {
  it("is false for a message with no way out", () => {
    expect(hasUnsubscribePlaceholder("<p>Hello {{nome}}</p>")).toBe(false);
  });

  it("does not mistake another placeholder for the link", () => {
    expect(hasUnsubscribePlaceholder("{{email}}")).toBe(false);
  });
});

describe("⚠️⚠️ a document's fields", () => {
  const quote = documentValues({ quoteNumber: "P-2026-014", amount: "€ 1.220,00", dueDate: "31/10/2026" });

  it("fill the parts a template left in brackets, in either language and any case", () => {
    expect(
      renderPlaceholders("Il preventivo [numero preventivo] vale [Importo], fino al [data di scadenza].", quote),
    ).toBe("Il preventivo P-2026-014 vale € 1.220,00, fino al 31/10/2026.");
    expect(renderPlaceholders("Quote [quote number], valid until [expiry date]", quote)).toBe(
      "Quote P-2026-014, valid until 31/10/2026",
    );
    expect(renderPlaceholders("Preventivo {{numero_preventivo}}", quote)).toBe("Preventivo P-2026-014");
  });

  it("leave a bracket they have no value for, so the dialog still asks about it", () => {
    const noExpiry = documentValues({ quoteNumber: "P-1" });
    expect(renderPlaceholders("Valido fino al [data di scadenza]", noExpiry)).toBe("Valido fino al [data di scadenza]");
    expect(renderPlaceholders("Fattura [numero fattura]", quote)).toBe("Fattura [numero fattura]");
    expect(renderPlaceholders("Nel merito di [argomento]", quote)).toBe("Nel merito di [argomento]");
  });

  it("are not filled by a caller that was not given them: the sender's values leave them for the dialog", () => {
    expect(renderPlaceholders("[numero preventivo] {{numero_preventivo}}", { senderName: "Marco" })).toBe(
      "[numero preventivo] {{numero_preventivo}}",
    );
  });

  it("filled, nothing is left to ask about; left, both spellings are", () => {
    const text = "Preventivo [numero preventivo] di [importo]";
    expect(pendingFields(renderPlaceholders(text, quote), { deal: false })).toEqual([]);
    expect(pendingFields("Preventivo {{numero_preventivo}} [numero preventivo]", { deal: true })).toEqual([
      "[numero preventivo]",
      "{{numero_preventivo}}",
    ]);
  });
});

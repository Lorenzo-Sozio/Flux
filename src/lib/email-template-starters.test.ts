/**
 * The basic templates, as they are written into a workspace — in both languages.
 *
 * ⚠️⚠️ A starter reaches customers through every salesperson who uses it. A field the catalogue
 * does not know would be sent as typed, a message that does not parse would throw when pressed,
 * and a text in one language only would give the other half of the users nothing.
 */
import { readFileSync } from "node:fs";

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import {
  documentValues,
  findUnknownPlaceholders,
  PLACEHOLDERS,
  pendingFields,
  renderPlaceholders,
  senderValues,
  valuesForRecipient,
} from "./email-placeholders";
import { PERSONAL_CATEGORIES } from "./email-template-rules";
import { STARTER_FIELDS, STARTER_TEMPLATES, starterBodyHtml } from "./email-template-starters";

const messages = (lang: string) => JSON.parse(readFileSync(`messages/${lang}.json`, "utf8"));

describe.each(["it", "en"])("⚠️⚠️ the basic templates in %s", (lang) => {
  // Loosely typed: the keys are built from the catalogue, which the messages are checked against here.
  const t = createTranslator({
    locale: lang,
    messages: messages(lang),
    namespace: "emailTemplates.starters",
  }) as unknown as (key: string, values?: Record<string, string>) => string;

  it.each(STARTER_TEMPLATES.map((s) => [s.key, s.category]))("%s renders, with fields the catalogue knows", (key) => {
    const subject = t(`${key}.subject`, STARTER_FIELDS);
    const body = starterBodyHtml(t(`${key}.body`, STARTER_FIELDS));
    expect(t(`${key}.name`).length).toBeGreaterThan(0);
    expect(findUnknownPlaceholders(subject)).toEqual([]);
    expect(findUnknownPlaceholders(body)).toEqual([]);
    // No ICU argument left unrendered: a "{first}" in a customer's inbox.
    expect(`${subject}${body}`).not.toMatch(/\{(?!\{)[a-zA-Z]+\}(?!\})/);
  });

  it("carries a signature, filled in by the server when the email is sent", () => {
    for (const s of STARTER_TEMPLATES) expect(t(`${s.key}.body`, STARTER_FIELDS)).toContain("{{mittente}}");
  });

  it("⚠️⚠️ writes what a document knows as its field, never as a part to type by hand", () => {
    const markers = PLACEHOLDERS.flatMap((p) => p.markers ?? []);
    for (const s of STARTER_TEMPLATES) {
      const text = `${t(`${s.key}.subject`, STARTER_FIELDS)}\n${t(`${s.key}.body`, STARTER_FIELDS)}`.toLowerCase();
      for (const m of markers) expect(text, `${s.key}: [${m}]`).not.toContain(`[${m}]`);
    }
  });

  it.each([
    "quote",
    "quoteFollowup",
    "quoteExpiring",
    "invoiceSend",
    "paymentReminder",
    "paymentOverdue",
    "contractRenewal",
    "orderConfirm",
    "orderShipped",
  ])("%s, sent with its document, leaves nothing for the person to fill in", (key) => {
    const values = {
      ...valuesForRecipient({ firstName: "Giulia", company: "Acme" }),
      ...senderValues({ name: "Marco", email: "m@x.it", company: "Flux" }),
      ...documentValues({
        quoteNumber: "P-2026-014",
        invoiceNumber: "27/2026",
        amount: "€ 1.220,00",
        dueDate: "31/10/2026",
        iban: "IT60X0542811101000000123456",
        orderNumber: "ORD-2026-031",
        deliveryDate: "15/10/2026",
        carrier: "BRT",
        trackingCode: "1Z999AA10123456784",
        contractReference: "Assistenza annuale",
        contractEndDate: "31/12/2026",
        ticketSubject: "Stampante non collegata",
      }),
    };
    const text = `${t(`${key}.subject`, STARTER_FIELDS)}\n${t(`${key}.body`, STARTER_FIELDS)}`;
    const sent = renderPlaceholders(text, values);
    expect(pendingFields(sent, { deal: false })).toEqual([]);
    expect(sent).not.toContain("{{");
  });

  it("names each template once, so adding the basics again adds only the missing ones", () => {
    const names = STARTER_TEMPLATES.map((s) => t(`${s.key}.name`).toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the catalogue", () => {
  it("covers every part of the CRM a customer is written to about", () => {
    const covered = new Set(STARTER_TEMPLATES.map((s) => s.category));
    for (const c of ["intro", "followup", "meeting", "quote", "deal", "order", "contract", "invoice", "support"]) {
      expect(covered, c).toContain(c);
    }
    for (const s of STARTER_TEMPLATES) expect(PERSONAL_CATEGORIES).toContain(s.category);
  });
});

describe("starterBodyHtml", () => {
  it("makes paragraphs of blank lines and keeps a signature's lines together", () => {
    expect(starterBodyHtml("Gentile {{nome}},\n\nCordiali saluti,\n{{mittente}}")).toBe(
      "<p>Gentile {{nome}},</p><p>Cordiali saluti,<br>{{mittente}}</p>",
    );
  });
});

describe("⚠️ pendingFields", () => {
  it("names what would reach the customer unfilled", () => {
    expect(pendingFields("Fattura [numero fattura] per {{trattativa}}, {{nome}}", { deal: false })).toEqual([
      "[numero fattura]",
      "{{trattativa}}",
    ]);
  });

  it("does not ask about a deal's field from a deal, nor about the recipient's and the sender's", () => {
    expect(pendingFields("{{trattativa}} {{nome}} {{mittente}}", { deal: true })).toEqual([]);
  });

  it("asks about a field nobody knows, and about an unsubscribe link in a one-to-one email", () => {
    expect(pendingFields("{{sconto}} {{link_unsubscribe}}", { deal: true })).toEqual([
      "{{sconto}}",
      "{{link_unsubscribe}}",
    ]);
  });
});

describe("⚠️⚠️ filling in, in two places", () => {
  it("leaves the fields it was not given for whoever can fill them — the dialog, then the server", () => {
    const inDialog = renderPlaceholders("{{nome}}, {{mittente}}", valuesForRecipient({ firstName: "Anna" }));
    expect(inDialog).toBe("Anna, {{mittente}}");
    expect(renderPlaceholders(inDialog, senderValues({ name: "Luca" }))).toBe("Anna, Luca");
  });
});

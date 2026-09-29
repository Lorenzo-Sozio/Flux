/**
 * ⚠️⚠️ Fatture in Cloud against recorded answers (API v2, the models of its TypeScript SDK 2.1.3).
 *
 * It takes no FatturaPA file, so the invoice is created there from its data and then sent. What
 * must hold: the document carries Flux's number, lines, rates and installments; a document whose
 * totals differ from the frozen ones by a cent is deleted and never sent; a send that fails leaves
 * nothing holding the number; the file SDI received is kept; `sent` is not "delivered" until SDI's
 * window to discard has passed.
 */
import { describe, expect, it } from "vitest";

import { DISCARD_WINDOW_DAYS, fattureInCloudProvider as fic, ficDocument, ficStatus, vatIdFor } from "./fattureincloud";
import type { OutgoingInvoice, SdiContext } from "./types";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function recorder(answers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      auth: new Headers(init?.headers).get("Authorization"),
    };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected call ${call.method} ${url}`);
    return answer(call);
  };
  return { calls, fetchImpl };
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });
const NOW = new Date("2026-09-29T10:00:00Z");

const ctx = (fetchImpl: SdiContext["fetch"], accountId: string | null = "42"): SdiContext => ({
  environment: "production",
  username: "",
  password: "a/tok.en",
  accountId,
  token: null,
  fetch: fetchImpl,
  now: () => NOW,
  saveToken: async () => undefined,
});

const VAT_TYPES = json(200, {
  data: [
    { id: 0, value: 22, ei_type: null },
    { id: 7, value: 22, ei_type: null, is_disabled: true },
    { id: 21, value: 0, ei_type: "N2.2" },
    { id: 5, value: 10, ei_type: null },
  ],
});

function invoice(over: Partial<OutgoingInvoice["document"]> = {}): OutgoingInvoice {
  return {
    name: "IT01234567890_00001.xml",
    xml: "<p:FatturaElettronica/>",
    document: {
      documentType: "TD01",
      documentNumber: "12",
      number: 12,
      series: "",
      issueDate: "2026-09-29",
      currency: "EUR",
      discountPercent: 0,
      stampDuty: false,
      paymentMethod: "MP05",
      dueDate: "2026-10-29",
      installments: null,
      notes: null,
      issuer: { name: "Esempio S.r.l.", vatNumber: "01234567890", iban: "IT60X0542811101000000123456" },
      customer: { name: "Cliente S.p.A.", vatNumber: "09876543210", country: "IT", sdiCode: "ABC1234", city: "Roma" },
      lines: [
        { description: "Consulenza", quantity: 2, unitPrice: 50, taxPercent: 22 },
        { description: "Formazione esente", quantity: 1, unitPrice: 30, taxPercent: 0, nature: "N2.2" },
      ],
      transmissionId: "00001",
      ...over,
    } as OutgoingInvoice["document"],
  };
}
// 100 at 22% + 30 exempt: net 130, VAT 22, gross 152.
const CREATED = json(200, { data: { id: 9001, amount_net: 130, amount_vat: 22, amount_gross: 152 } });
const SENT = json(200, { data: { name: "IT12345678901_a1b2c.xml", date: "2026-09-29" } });
const XML_BACK = () =>
  new Response('<?xml version="1.0"?><p:FatturaElettronica>FiC</p:FatturaElettronica>', { status: 200 });

describe("⚠️⚠️ the document Fatture in Cloud is asked to create", () => {
  it("carries Flux's number, date, customer, lines with the workspace's VAT ids, and the total as payment", () => {
    const doc = ficDocument(invoice().document, [
      { id: 0, value: 22, ei_type: null },
      { id: 21, value: 0, ei_type: "N2.2" },
    ]);
    expect(doc.missing).toEqual([]);
    expect(doc.body.data).toMatchObject({
      type: "invoice",
      number: 12,
      numeration: "",
      date: "2026-09-29",
      e_invoice: true,
      entity: { name: "Cliente S.p.A.", vat_number: "09876543210", ei_code: "ABC1234", country_iso: "IT" },
      ei_data: { payment_method: "MP05", bank_iban: "IT60X0542811101000000123456" },
      payments_list: [{ amount: 152, due_date: "2026-10-29", status: "not_paid" }],
    });
    expect(doc.body.data.items_list).toEqual([
      { name: "Consulenza", qty: 2, net_price: 50, discount: 0, vat: { id: 0 } },
      { name: "Formazione esente", qty: 1, net_price: 30, discount: 0, vat: { id: 21 } },
    ]);
  });

  it("is a credit note citing the invoice it corrects, and a series is its numeration", () => {
    const doc = ficDocument(
      invoice({
        documentType: "TD04",
        series: "B",
        originalInvoice: { documentNumber: "7", issueDate: "2026-09-01" },
      }).document,
      [
        { id: 0, value: 22 },
        { id: 21, value: 0, ei_type: "N2.2" },
      ],
    );
    expect(doc.body.data).toMatchObject({
      type: "credit_note",
      numeration: "/B",
      ei_data: { invoice_number: "7", invoice_date: "2026-09-01" },
    });
  });

  it("⚠️ matches a rate by percentage and Natura, never a disabled one", () => {
    const types = [
      { id: 7, value: 22, is_disabled: true },
      { id: 0, value: 22, ei_type: "" },
      { id: 21, value: 0, ei_type: "N2.2" },
      { id: 22, value: 0, ei_type: "N4" },
    ];
    expect(vatIdFor(types, 22, null)).toBe(0);
    expect(vatIdFor(types, 0, "N4")).toBe(22);
    expect(vatIdFor(types, 0, "N3.1")).toBeNull();
    expect(vatIdFor(types, 4, null)).toBeNull();
  });
});

describe("⚠️⚠️ sending", () => {
  it("creates, checks the totals, sends, and keeps the file SDI received", async () => {
    const { calls, fetchImpl } = recorder([VAT_TYPES, CREATED, SENT, XML_BACK]);
    expect(await fic.send(ctx(fetchImpl), invoice())).toEqual({
      ok: true,
      fileName: "IT12345678901_a1b2c.xml",
      ref: "9001",
      sentXml: '<?xml version="1.0"?><p:FatturaElettronica>FiC</p:FatturaElettronica>',
    });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api-v2.fattureincloud.it", "")}`)).toEqual([
      "GET /c/42/info/vat_types",
      "POST /c/42/issued_documents",
      "POST /c/42/issued_documents/9001/e_invoice/send",
      "GET /c/42/issued_documents/9001/e_invoice/xml",
    ]);
    expect(calls.every((c) => c.auth === "Bearer a/tok.en")).toBe(true);
    expect(calls[2].body).toEqual({ data: {}, options: { dry_run: false } });
  });

  it("⚠️⚠️ another total by a cent: the document is deleted and nothing reaches SDI", async () => {
    const { calls, fetchImpl } = recorder([
      VAT_TYPES,
      json(200, { data: { id: 9001, amount_net: 130, amount_vat: 21.99, amount_gross: 151.99 } }),
      json(200, {}),
    ]);
    const sent = await fic.send(ctx(fetchImpl), invoice());
    expect(sent).toMatchObject({ ok: false, reason: "invalid" });
    expect(!sent.ok && sent.message).toBe("totals:vat 21.99 ≠ 22; gross 151.99 ≠ 152");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(calls[2].url).toMatch(/\/issued_documents\/9001$/);
    expect(calls.some((c) => c.url.endsWith("/e_invoice/send"))).toBe(false);
  });

  it("⚠️ a send Fatture in Cloud refuses leaves nothing there holding the number", async () => {
    const { calls, fetchImpl } = recorder([
      VAT_TYPES,
      CREATED,
      json(422, { error: { message: "Codice destinatario non valido" } }),
      json(200, {}),
    ]);
    const sent = await fic.send(ctx(fetchImpl), invoice());
    expect(sent).toMatchObject({ ok: false, reason: "invalid" });
    expect(!sent.ok && sent.message).toContain("Codice destinatario non valido");
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("refuses before creating anything when a rate is missing there, or for a deposit invoice", async () => {
    const missing = recorder([json(200, { data: [{ id: 0, value: 22 }] })]);
    expect(await fic.send(ctx(missing.fetchImpl), invoice())).toEqual({
      ok: false,
      reason: "invalid",
      message: "vat:0% N2.2",
    });
    expect(missing.calls).toHaveLength(1);
    const deposit = recorder([]);
    expect(await fic.send(ctx(deposit.fetchImpl), invoice({ documentType: "TD02" }))).toEqual({
      ok: false,
      reason: "invalid",
      message: "TD02",
    });
    expect(deposit.calls).toEqual([]);
  });

  it("says the token was refused", async () => {
    const { fetchImpl } = recorder([json(401, { error: { message: "Unauthorized" } })]);
    expect(await fic.send(ctx(fetchImpl), invoice())).toMatchObject({ ok: false, reason: "auth" });
  });
});

describe("⚠️⚠️ what SDI said", () => {
  it("maps every ei_status the SDK defines", () => {
    const at = (value: string) => ficStatus(value, NOW, NOW);
    expect(
      [
        "attempt",
        "missing",
        "not_sent",
        "sent",
        "pending",
        "processing",
        "error",
        "discarded",
        "not_delivered",
        "accepted",
        "rejected",
        "no_response",
        "manual_accepted",
        "manual_rejected",
      ].map(at),
    ).toEqual([
      "pending",
      "error",
      "pending",
      "pending",
      "pending",
      "pending",
      "error",
      "rejected",
      "not_delivered",
      "accepted",
      "refused",
      "expired",
      "accepted",
      "refused",
    ]);
    expect(at("whatever")).toBeNull();
  });

  it("⚠️⚠️ 'sent' is delivered only once SDI's window to discard has passed", () => {
    const day = 86_400_000;
    expect(ficStatus("sent", new Date(NOW.getTime() - (DISCARD_WINDOW_DAYS - 1) * day), NOW)).toBe("pending");
    expect(ficStatus("sent", new Date(NOW.getTime() - (DISCARD_WINDOW_DAYS + 1) * day), NOW)).toBe("delivered");
    // A discard is a discard at any age.
    expect(ficStatus("discarded", new Date(NOW.getTime() - 30 * day), NOW)).toBe("rejected");
  });

  it("reads a discard with SDI's reason", async () => {
    const { calls, fetchImpl } = recorder([
      json(200, { data: { id: 9001, ei_status: "discarded" } }),
      json(200, { data: { code: "00305", reason: "IdCodice non valido", solution: "Correggi la P.IVA" } }),
    ]);
    expect(await fic.status(ctx(fetchImpl), { fileName: null, ref: "9001", sentAt: NOW })).toEqual({
      ok: true,
      status: "rejected",
      sdiId: null,
      message: "00305 — IdCodice non valido — Correggi la P.IVA",
    });
    expect(calls[0].url).toBe("https://api-v2.fattureincloud.it/c/42/issued_documents/9001?fieldset=detailed");
  });
});

describe("checking the token", () => {
  it("lists the companies it reaches, and refuses one it does not", async () => {
    const companies = json(200, {
      data: {
        companies: [
          { id: 42, name: "Esempio" },
          { id: 43, name: "Altra" },
        ],
      },
    });
    const one = recorder([companies]);
    expect(await fic.check(ctx(one.fetchImpl, null))).toEqual({
      ok: true,
      accounts: [
        { id: "42", name: "Esempio" },
        { id: "43", name: "Altra" },
      ],
    });
    const wrong = recorder([companies]);
    expect(await fic.check(ctx(wrong.fetchImpl, "99"))).toMatchObject({ ok: false, reason: "account" });
  });
});

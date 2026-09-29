/**
 * ⚠️⚠️ Handing issued invoices to SDI through the intermediary, and reading back what SDI said
 * (src/lib/sdi/transmit.ts), on PGlite with Aruba's answers recorded.
 *
 * The claim decides who sends; the file is the one frozen at issue with the intermediary's
 * transmitter; a status only moves forward; the password and tokens never sit in clear.
 */
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";
import { readInvoiceFile } from "@/lib/invoice-archive";
import { contentHash } from "@/lib/storage";
import { encryptSecret } from "@/lib/tenant-db";

import { pollSdiStatuses, prepareForSdi, readSdiSettings, sendToSdi } from "./transmit";

const db = drizzle(new PGlite(), { schema });
const NOW = new Date("2026-09-29T10:00:00Z");
let savedKey: string | undefined;

type Answer = (url: string, init?: RequestInit) => Response;
const calls: { url: string; body: string }[] = [];
let answers: Answer[] = [];
const fakeFetch = async (url: string, init?: RequestInit) => {
  calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
  const next = answers.shift();
  if (!next) throw new Error(`unexpected call ${url}`);
  return next(url, init);
};
const json =
  (status: number, body: unknown): Answer =>
  () =>
    new Response(JSON.stringify(body), { status });
const TOKEN = json(200, { access_token: "A1", refresh_token: "R1", expires_in: 1800 });
const UPLOADED = json(200, { errorCode: "0000", uploadFileName: "IT01879020517_abc01.xml" });
const statusIs = (status: string, description?: string) =>
  json(200, { idSdi: "999", invoices: [{ status, statusDescription: description ?? null }] });

let numbered = 0;
async function invoice(id: string, over: { sdiCode?: string } = {}) {
  numbered++;
  await db.insert(schema.invoices).values({
    id,
    status: "issued",
    documentType: "TD01",
    series: "",
    fiscalYear: 2026,
    number: numbered,
    documentNumber: String(numbered),
    issueDate: "2026-09-29",
    total: "122",
    currency: "EUR",
    paymentMethod: "MP05",
    issuedBy: "u1",
    issuerSnapshot: { legalName: "Esempio S.r.l.", vatNumber: "01234567890", country: "IT" },
    customerSnapshot: {
      name: "Cliente S.p.A.",
      vatNumber: "09876543210",
      country: "IT",
      sdiCode: over.sdiCode ?? "ABC1234",
    },
    linesSnapshot: [{ description: "Consulenza", quantity: 1, unitPrice: 100, taxPercent: 22 }],
  } as never);
}

async function aruba(over: { autoSend?: boolean } = {}) {
  await db.insert(schema.sdiSettings).values({
    id: "workspace",
    channel: "aruba",
    environment: "demo",
    username: "flux-user",
    password: encryptSecret("s3cret"),
    autoSend: over.autoSend ?? false,
  });
}

const row = async (id: string) => (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];
const send = (id: string) => sendToSdi(db, id, { fetch: fakeFetch, now: () => NOW });

beforeAll(async () => {
  savedKey = process.env.PLATFORM_ENCRYPTION_KEY;
  process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await applyTenantMigrations(db as never);
}, 120_000);

afterAll(() => {
  process.env.PLATFORM_ENCRYPTION_KEY = savedKey;
});

beforeEach(async () => {
  calls.length = 0;
  answers = [];
  for (const t of ["invoice", "sdi_setting"]) await db.execute(sql.raw(`delete from "${t}"`));
});

describe("⚠️⚠️ sending", () => {
  it("hands the frozen file over with Aruba as transmitter, and records Aruba's name for it", async () => {
    await aruba();
    await invoice("i1");
    answers = [TOKEN, UPLOADED];
    expect(await send("i1")).toEqual({ ok: true, status: "pending", fileName: "IT01879020517_abc01.xml" });
    const sent = await row("i1");
    expect(sent).toMatchObject({
      sdiStatus: "pending",
      sdiChannel: "aruba",
      sdiFileName: "IT01879020517_abc01.xml",
      sdiTransmitter: { country: "IT", code: "01879020517" },
    });
    const xml = new TextDecoder().decode(
      Uint8Array.from(atob(JSON.parse(calls[1].body).dataFile), (c) => c.charCodeAt(0)),
    );
    expect(xml).toContain("<IdPaese>IT</IdPaese><IdCodice>01879020517</IdCodice>");
    // ⚠️ The XML served for download afterwards is the file that was sent, byte for byte, and the
    // fingerprint kept is the sent file's.
    const served = await readInvoiceFile(db, sent, "xml");
    expect(new TextDecoder().decode(served.bytes)).toBe(xml);
    expect(sent.sdiFileSha256).toBe(contentHash(new TextEncoder().encode(xml)));
  });

  it("⚠️⚠️ an XML archived with another transmitter before the send is never served as the invoice's", async () => {
    await aruba();
    await invoice("i1");
    answers = [TOKEN, UPLOADED];
    await send("i1");
    const sentXml = new TextDecoder().decode(
      Uint8Array.from(atob(JSON.parse(calls[1].body).dataFile), (c) => c.charCodeAt(0)),
    );
    // Archived at issue, before the workspace chose Aruba: the issuer's own code as transmitter.
    const archived = new TextEncoder().encode("<p:FatturaElettronica>own transmitter</p:FatturaElettronica>");
    const key = "invoices/202609/0f9c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b.xml";
    await db
      .update(schema.invoices)
      .set({ xmlKey: key, xmlSha256: contentHash(archived) })
      .where(eq(schema.invoices.id, "i1"));
    const store = { get: async () => archived, put: async () => undefined, delete: async () => undefined };
    const served = await readInvoiceFile(db, await row("i1"), "xml", store as never);
    expect(new TextDecoder().decode(served.bytes)).toBe(sentXml);
  });

  it("⚠️⚠️ through Fatture in Cloud: its document id and the file it built are kept, and served", async () => {
    await db.insert(schema.sdiSettings).values({
      id: "workspace",
      channel: "fattureincloud",
      environment: "production",
      password: encryptSecret("fic-token"),
      accountId: "42",
    });
    await invoice("i1");
    answers = [
      json(200, { data: [{ id: 0, value: 22 }] }),
      json(200, { data: { id: 9001, amount_net: 100, amount_vat: 22, amount_gross: 122 } }),
      json(200, { data: { name: "IT12345678901_a1b2c.xml" } }),
      () => new Response("<p:FatturaElettronica>by FiC</p:FatturaElettronica>", { status: 200 }),
    ];
    expect(await send("i1")).toEqual({ ok: true, status: "pending", fileName: "IT12345678901_a1b2c.xml" });
    const sent = await row("i1");
    expect(sent).toMatchObject({
      sdiChannel: "fattureincloud",
      sdiRef: "9001",
      sdiSentXml: "<p:FatturaElettronica>by FiC</p:FatturaElettronica>",
      // It builds its own file: no transmitter of Flux's is frozen.
      sdiTransmitter: null,
    });
    const served = await readInvoiceFile(db, sent, "xml");
    expect(new TextDecoder().decode(served.bytes)).toBe("<p:FatturaElettronica>by FiC</p:FatturaElettronica>");

    // Its status is read by the document id.
    answers = [json(200, { data: { id: 9001, ei_status: "not_delivered" } })];
    const run = await pollSdiStatuses(db, { fetch: fakeFetch, now: NOW });
    expect(run.changes).toMatchObject([{ invoiceId: "i1", to: "not_delivered" }]);
    expect(calls.at(-1)?.url).toBe("https://api-v2.fattureincloud.it/c/42/issued_documents/9001?fieldset=detailed");
  });

  it("⚠️⚠️ twice at once hands it over once: the claim decides", async () => {
    await aruba();
    await invoice("i1");
    answers = [TOKEN, UPLOADED];
    const [a, b] = await Promise.all([send("i1"), send("i1")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, reason: "not_sendable" });
    expect(calls.filter((c) => c.url.endsWith("/services/invoice/upload"))).toHaveLength(1);
  });

  it("refuses a draft, and an invoice already handed over", async () => {
    await aruba();
    await invoice("i1");
    await db.update(schema.invoices).set({ status: "draft" }).where(eq(schema.invoices.id, "i1"));
    expect(await send("i1")).toEqual({ ok: false, reason: "not_sendable" });
    await db
      .update(schema.invoices)
      .set({ status: "issued", sdiStatus: "delivered" })
      .where(eq(schema.invoices.id, "i1"));
    expect(await send("i1")).toEqual({ ok: false, reason: "not_sendable" });
    expect(calls).toEqual([]);
  });

  it("⚠️ a refused file is send_failed with Aruba's words, and may be sent again", async () => {
    await aruba();
    await invoice("i1");
    answers = [TOKEN, json(200, { errorCode: "0092", errorDescription: "Errore in validazione XSD" })];
    expect(await send("i1")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await row("i1")).toMatchObject({ sdiStatus: "send_failed", sdiMessage: "0092 Errore in validazione XSD" });
    answers = [UPLOADED];
    expect(await send("i1")).toMatchObject({ ok: true });
  });

  it("⚠️⚠️ one sign-in serves every send while it lasts, kept encrypted in the workspace", async () => {
    await aruba();
    await invoice("i1");
    await invoice("i2");
    answers = [TOKEN, UPLOADED, UPLOADED];
    await send("i1");
    await send("i2");
    expect(calls.filter((c) => c.url.endsWith("/auth/signin"))).toHaveLength(1);
    const settings = await readSdiSettings(db);
    expect(settings?.accessToken).toBeTruthy();
    expect(settings?.accessToken).not.toContain("A1");
    expect(settings?.password).not.toContain("s3cret");
  });

  it("does nothing by hand-transmission workspaces, or without credentials", async () => {
    await invoice("i1");
    expect(await send("i1")).toEqual({ ok: false, reason: "manual" });
    await db.insert(schema.sdiSettings).values({ id: "workspace", channel: "aruba", username: "u" });
    expect(await send("i1")).toEqual({ ok: false, reason: "not_configured" });
    expect((await row("i1")).sdiStatus).toBeNull();
  });

  it("⚠️ freezes the intermediary's transmitter at issue, so the archive holds the file that will be sent", async () => {
    await aruba({ autoSend: true });
    await invoice("i1");
    expect(await prepareForSdi(db, "i1")).toEqual({ autoSend: true });
    expect((await row("i1")).sdiTransmitter).toEqual({ country: "IT", code: "01879020517" });
  });
});

describe("⚠️⚠️ what SDI said", () => {
  async function handedOver(id: string, over: { sdiCode?: string; status?: string } = {}) {
    await invoice(id, over);
    await db
      .update(schema.invoices)
      .set({
        sdiStatus: over.status ?? "pending",
        sdiChannel: "aruba",
        sdiFileName: `${id}.xml`,
        sdiSentAt: new Date(NOW.getTime() - 3600_000),
      })
      .where(eq(schema.invoices.id, id));
  }
  const poll = () => pollSdiStatuses(db, { fetch: fakeFetch, now: NOW });

  it("records a discard with SDI's words, and reports the change once", async () => {
    await aruba();
    await handedOver("i1");
    answers = [TOKEN, statusIs("Scartata", "00305 IdCodice del cessionario non valido")];
    const run = await poll();
    expect(run.changes).toEqual([
      { invoiceId: "i1", from: "pending", to: "rejected", message: "00305 IdCodice del cessionario non valido" },
    ]);
    expect(await row("i1")).toMatchObject({ sdiStatus: "rejected", sdiId: "999" });
    // Discarded is final: the next run does not ask again.
    answers = [];
    expect((await poll()).checked).toBe(0);
  });

  it("⚠️ keeps asking about a public administration's invoice after delivery, and not a company's", async () => {
    await aruba();
    await handedOver("pa", { sdiCode: "UFABCD", status: "delivered" });
    await handedOver("b2b", { status: "delivered" });
    answers = [TOKEN, statusIs("Accettata")];
    const run = await poll();
    expect(run.checked).toBe(1);
    expect(await row("pa")).toMatchObject({ sdiStatus: "accepted" });
    expect(await row("b2b")).toMatchObject({ sdiStatus: "delivered" });
  });

  it("⚠️ never moves a status back: a late 'Inviata' does not undo 'Consegnata'", async () => {
    await aruba();
    await handedOver("pa", { sdiCode: "UFABCD", status: "delivered" });
    answers = [TOKEN, statusIs("Inviata")];
    expect((await poll()).changes).toEqual([]);
    expect(await row("pa")).toMatchObject({ sdiStatus: "delivered" });
  });

  it("⚠️ a send interrupted long ago is failed, with a word to check the portal first", async () => {
    await aruba();
    await invoice("i1");
    await db
      .update(schema.invoices)
      .set({ sdiStatus: "sending", sdiStatusAt: new Date(NOW.getTime() - 30 * 60_000) })
      .where(eq(schema.invoices.id, "i1"));
    const run = await poll();
    expect(run.interrupted).toBe(1);
    expect(await row("i1")).toMatchObject({ sdiStatus: "send_failed", sdiMessage: "interrupted" });
  });
});

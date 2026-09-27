/**
 * Accepting a quote by signing it (src/lib/quote-signature.ts), on a real Postgres and an
 * in-memory store: the record a simple electronic signature stands on, and the file it names.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { consentText, readSignature, readSignedPdf, signQuote } from "./quote-signature";
import { contentHash, type StorageDriver } from "./storage";

const db = drizzle(new PGlite(), { schema });
const NOW = new Date("2026-09-27T10:00:00Z");

function memoryStore(onPut?: () => Promise<void>) {
  const objects = new Map<string, Uint8Array>();
  const driver: StorageDriver = {
    name: "memory",
    async put(key, body) {
      objects.set(key, body);
      await onPut?.();
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { driver, objects };
}

const quote = async () =>
  (await db.execute(sql`select * from quote where id = 'q1'`)).rows[0] as Record<string, string | null>;
const sign = (store: StorageDriver | null, name = "Mario Rossi") =>
  signQuote(db, "q1", { name, ip: "203.0.113.9", userAgent: "Firefox", workspaceName: "Esempio" }, NOW, store);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["quote_activity", "quote_item", "quote", "deal", "company"])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`insert into company (id, name, language) values ('co1', 'Bar Roma', null)`);
  await db.execute(sql`insert into deal (id, name, amount, company_id) values ('d1', 'Fornitura', '100', 'co1')`);
  await db.execute(sql`insert into quote (id, quote_number, deal_id, company_id, status, subtotal, total_amount, public_token)
    values ('q1', 'QT-202609-AAAA', 'd1', 'co1', 'sent', '100', '122', 'tok1')`);
  await db.execute(sql`insert into quote_item (id, quote_id, description, quantity, unit_price, total_price)
    values ('i1', 'q1', 'Consulenza', 1, '100', '122')`);
});

describe("what counts as a signature", () => {
  it("⚠️⚠️ a name with letters and the box ticked — nothing less", () => {
    expect(readSignature({ signerName: "  Mario   Rossi ", consent: true })).toEqual({ name: "Mario Rossi" });
    expect(readSignature({ signerName: "Mario Rossi", consent: "yes" })).toBeNull();
    expect(readSignature({ signerName: "Mario Rossi" })).toBeNull();
    expect(readSignature({ signerName: "MR", consent: true })).toBeNull();
    expect(readSignature({ signerName: "123 456", consent: true })).toBeNull();
    expect(readSignature({ signerName: "x".repeat(121), consent: true })).toBeNull();
  });
});

describe("⚠️⚠️ signing", () => {
  it("accepts the quote and records who, what they agreed to, when, from where — and the file's fingerprint", async () => {
    const { driver, objects } = memoryStore();
    const result = await sign(driver);
    expect(result.ok).toBe(true);
    const q = await quote();
    expect(q).toMatchObject({
      status: "accepted",
      signed_name: "Mario Rossi",
      signed_ip: "203.0.113.9",
      signed_user_agent: "Firefox",
      // The server's text, in the customer's language (Italian: no language, no country).
      signed_consent: consentText("it", "QT-202609-AAAA"),
    });
    // The fingerprint is of exactly the bytes kept.
    const kept = objects.get(String(q.signed_pdf_key));
    expect(kept).toBeDefined();
    expect(contentHash(kept as Uint8Array)).toBe(q.signed_pdf_sha256);
    expect(new TextDecoder().decode((kept as Uint8Array).slice(0, 5))).toBe("%PDF-");
  });

  it("⚠️ in the customer's language: an English customer agrees to an English sentence", async () => {
    await db.execute(sql`update company set language = 'en'`);
    await sign(memoryStore().driver);
    expect((await quote()).signed_consent).toBe(consentText("en", "QT-202609-AAAA"));
    expect((await quote()).signed_consent).toContain("I accept quote QT-202609-AAAA");
  });

  it("⚠️⚠️ two signatures at once sign once, and the loser takes its file away", async () => {
    // While this signature stores its PDF, another one lands first.
    const { driver, objects } = memoryStore(async () => {
      await db.execute(sql`update quote set status = 'accepted', signed_name = 'Primo' where id = 'q1'`);
    });
    expect(await sign(driver, "Secondo")).toEqual({ ok: false, reason: "not_actionable" });
    expect((await quote()).signed_name).toBe("Primo");
    expect(objects.size).toBe(0);
  });

  it("a draft, or a quote already decided, cannot be signed", async () => {
    await db.execute(sql`update quote set status = 'draft'`);
    // Refused before a PDF is built or uploaded, not by the update after it.
    let uploads = 0;
    const counted = memoryStore(async () => {
      uploads++;
    });
    expect(await sign(counted.driver)).toEqual({ ok: false, reason: "not_actionable" });
    expect(uploads).toBe(0);
    expect(
      await signQuote(db, "nope", { name: "X Y", ip: null, userAgent: null, workspaceName: null }, NOW, null),
    ).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("⚠️ with no storage configured the signature stands on its record and fingerprint", async () => {
    const result = await sign(null);
    expect(result).toMatchObject({ ok: true, pdfKey: null });
    const q = await quote();
    expect(q.status).toBe("accepted");
    expect(q.signed_pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(q.signed_pdf_key).toBeNull();
  });
});

describe("⚠️⚠️ the signed file back", () => {
  it("is served only while it still matches its fingerprint", async () => {
    const { driver, objects } = memoryStore();
    await sign(driver);
    const q = await quote();
    const row = { signedPdfKey: q.signed_pdf_key, signedPdfSha256: q.signed_pdf_sha256 };
    expect((await readSignedPdf(driver, row)).ok).toBe(true);
    // Somebody swaps the bytes in the bucket.
    objects.set(String(q.signed_pdf_key), new TextEncoder().encode("%PDF- something else"));
    expect(await readSignedPdf(driver, row)).toEqual({ ok: false, reason: "altered" });
    expect(await readSignedPdf(driver, { signedPdfKey: null, signedPdfSha256: null })).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});

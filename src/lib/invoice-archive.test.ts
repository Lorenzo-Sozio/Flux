/**
 * Keeping an issued invoice's files, on a real Postgres and an in-memory store.
 *
 * ⚠️⚠️ What these guard: an invoice with two different archived XMLs, a file
 * overwritten after it was sent, and a corrupted object served as if it were the
 * original. None of them shows on a screen.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { archiveInvoice, archiveKey, isValidArchiveKey, readInvoiceFile } from "./invoice-archive";
import type { StorageDriver } from "./storage";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from invoice`);
});

function memoryStore(onPut?: (key: string) => Promise<void>) {
  const objects = new Map<string, Uint8Array>();
  const driver: StorageDriver = {
    name: "memory",
    async put(key, body) {
      objects.set(key, body);
      await onPut?.(key);
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

const ISSUER = {
  legalName: "Esempio S.r.l.",
  vatNumber: "00905811006",
  fiscalCode: "00905811006",
  taxRegime: "RF01",
  street: "Via Roma 1",
  zipCode: "00100",
  city: "Roma",
  province: "RM",
  country: "IT",
  iban: "IT60X0542811101000000123456",
};
const CUSTOMER = {
  name: "Cliente S.p.A.",
  vatNumber: "00488410010",
  street: "Corso Italia 2",
  zipCode: "20100",
  city: "Milano",
  province: "MI",
  country: "IT",
  sdiCode: "ABC1234",
};

async function issued(id: string, over: { status?: string; type?: string } = {}) {
  const lines = JSON.stringify([
    { description: "Consulenza", quantity: 2, unitPrice: 150, taxPercent: 22 },
    { description: "Esportazione", quantity: 1, unitPrice: 90, taxPercent: 0, nature: "N3.1" },
  ]);
  await db.execute(sql`
    insert into invoice (id, status, document_type, series, fiscal_year, number, document_number, issue_date,
      due_date, issuer_snapshot, customer_snapshot, lines_snapshot, total)
    values (${id}, ${over.status ?? "issued"}, ${over.type ?? "TD01"}, '', 2026, 7, '7', '2026-09-16', '2026-10-16',
      ${JSON.stringify(ISSUER)}::jsonb, ${JSON.stringify(CUSTOMER)}::jsonb, ${lines}::jsonb, '456')`);
}

const row = async (id: string) =>
  ((await db.execute(sql`select * from invoice where id = ${id}`)) as { rows: Record<string, unknown>[] }).rows[0];

describe("keys", () => {
  it("⚠️ carries nothing from the invoice, and only its own shape is accepted", () => {
    const key = archiveKey("xml", new Date("2026-09-16T10:00:00Z"));
    expect(key).toMatch(/^invoices\/202609\/[0-9a-f-]{36}\.xml$/);
    expect(isValidArchiveKey(key, "xml")).toBe(true);
    expect(isValidArchiveKey(key, "pdf"), "an XML key read as a PDF").toBe(false);
    expect(isValidArchiveKey("documents/202609/../../secrets.xml", "xml")).toBe(false);
    expect(isValidArchiveKey(`${key}/../x.xml`, "xml")).toBe(false);
  });
});

describe("archiving", () => {
  it("⚠️⚠️ writes the XML and the PDF once, records their hashes, and does nothing the second time", async () => {
    await issued("a");
    const { driver, objects } = memoryStore();

    expect(await archiveInvoice(db, "a", driver)).toBe("archived");
    const r = await row("a");
    expect(isValidArchiveKey(String(r.xml_key), "xml")).toBe(true);
    expect(isValidArchiveKey(String(r.pdf_key), "pdf")).toBe(true);
    expect(r.archived_at).not.toBeNull();
    expect(objects.size).toBe(2);

    const xml = new TextDecoder().decode(objects.get(String(r.xml_key)));
    expect(xml).toContain("<Numero>7</Numero>");
    expect(xml).toContain("<Natura>N3.1</Natura>");
    expect(new TextDecoder().decode(objects.get(String(r.pdf_key))?.slice(0, 5))).toBe("%PDF-");

    expect(await archiveInvoice(db, "a", driver)).toBe("already");
    expect(objects.size, "archived again").toBe(2);
    expect((await row("a")).xml_key).toBe(r.xml_key);
  }, 60_000);

  it("⚠️⚠️ losing the race keeps the winner's files and deletes its own", async () => {
    await issued("a");
    let winnerKey: string | null = null;
    // Another request records its files between this one's upload and its update.
    const { driver, objects } = memoryStore(async (key) => {
      if (winnerKey || !key.endsWith(".pdf")) return;
      winnerKey = "invoices/202609/00000000-0000-4000-8000-000000000000.xml";
      await db.execute(
        sql`update invoice set xml_key = ${winnerKey}, pdf_key = 'invoices/202609/00000000-0000-4000-8000-000000000001.pdf' where id = 'a'`,
      );
    });

    expect(await archiveInvoice(db, "a", driver)).toBe("lost_race");
    expect((await row("a")).xml_key, "the winner was overwritten").toBe(winnerKey);
    expect(objects.size, "the loser's files were left behind").toBe(0);
  }, 60_000);

  it("⚠️ a draft is not archived", async () => {
    await issued("d", { status: "draft" });
    const { driver, objects } = memoryStore();
    expect(await archiveInvoice(db, "d", driver)).toBe("not_issued");
    expect(await archiveInvoice(db, "ghost", driver)).toBe("missing");
    expect(objects.size).toBe(0);
  });
});

describe("reading", () => {
  it("⚠️⚠️ serves the archived bytes, and rebuilds instead of serving an altered object", async () => {
    await issued("a");
    const { driver, objects } = memoryStore();
    await archiveInvoice(db, "a", driver);
    const invoice = await readRow("a");

    const first = await readInvoiceFile(db, invoice, "xml", driver);
    expect(first.archived).toBe(true);
    expect(first.name).toMatch(/^IT00905811006_[A-Z0-9]{5}\.xml$/);

    const key = String((await row("a")).xml_key);
    const original = objects.get(key) as Uint8Array;
    objects.set(key, new TextEncoder().encode("<tampered/>"));
    const second = await readInvoiceFile(db, invoice, "xml", driver);
    expect(second.archived, "an altered file was served as archived").toBe(false);
    expect(new TextDecoder().decode(second.bytes)).toBe(new TextDecoder().decode(original));
  }, 60_000);

  it("builds the file from the snapshots when nothing is archived yet", async () => {
    await issued("a");
    const { driver } = memoryStore();
    const file = await readInvoiceFile(db, await readRow("a"), "pdf", driver);
    expect(file.archived).toBe(false);
    expect(file.name).toBe("Fattura-7.pdf");
    expect(new TextDecoder().decode(file.bytes.slice(0, 5))).toBe("%PDF-");
  }, 60_000);
});

async function readRow(id: string) {
  const { invoices } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [r] = await db.select().from(invoices).where(eq(invoices.id, id));
  return r;
}

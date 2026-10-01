/**
 * The signature and the letterhead as the send composes them (src/lib/email-deliver.ts
 * `composeEmail`), on a real tenant schema: read from `workspace_setting` and the invoicing
 * details, added once, and left off when the person said so.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

const db = drizzle(new PGlite(), { schema });

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t-acme" }));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t-acme", name: "Acme" }) }));
vi.stubEnv("AUTH_SECRET", "a-secret-long-enough-for-the-tests-0123456789");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://crm.example.it");

const { composeEmail } = await import("./email-deliver");
const { verifyBrandLogoToken } = await import("./brand-logo-token");
const { invoiceCopyLayout, paymentReminderLayout } = await import("./email");
const { loadEmailBrand } = await import("./email-brand-load");

const setting = (key: string, value: unknown) =>
  db.execute(sql`insert into workspace_setting (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value`);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Giulia Ferri', 'giulia@acme.it')`);
  await db.execute(sql`insert into invoice_issuer (id, legal_name, vat_number, street, zip_code, city, phone)
    values ('workspace', 'Acme S.r.l.', 'IT01234567890', 'Via Roma 1', '20100', 'Milano', '+39 02 123')`);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from workspace_setting`);
  await setting("brand.identity", { color: "#9f1239", website: "acme.it", socials: { linkedin: "linkedin.com/acme" } });
  await setting("brand.logo", { key: "logos/abc.png", contentType: "image/png" });
  await setting("signature.u1", { title: "Responsabile commerciale", mobile: "+39 333 1", enabled: true });
});

const compose = (html: string, signature?: "full" | "compact" | "none") =>
  composeEmail(db, { userId: "u1" }, { subject: "Ciao", html, signature });

describe("⚠️⚠️ the sender's signature", () => {
  it("is added under a personal email, with the Profile's role and the workspace's identity", async () => {
    const { html } = await compose("<p>Buongiorno</p>", "full");
    expect(html.indexOf("Buongiorno")).toBeLessThan(html.indexOf("Giulia Ferri"));
    expect(html).toContain("Responsabile commerciale · Acme S.r.l.");
    expect(html).toContain("#9f1239");
    expect(html).toContain('href="https://acme.it/"');
    expect(html).toContain("P.IVA IT01234567890");
  });

  it("is left off when the person took it off this email", async () => {
    const { html } = await compose("<p>Buongiorno</p>", "none");
    expect(html).toBe("<p>Buongiorno</p>");
  });

  it("⚠️ is left off when the person switched theirs off in the Profile, whatever the dialog says", async () => {
    await setting("signature.u1", { title: "x", enabled: false });
    const { html } = await compose("<p>Buongiorno</p>", "full");
    expect(html).not.toContain("Giulia Ferri");
  });

  it("⚠️ goes where the template placed {{firma}}, and only there", async () => {
    const { html } = await compose("<p>A</p>{{firma}}<p>B</p>", "full");
    expect(html.split("Responsabile commerciale").length - 1).toBe(1);
    expect(html.indexOf("Responsabile commerciale")).toBeLessThan(html.indexOf("<p>B</p>"));
  });

  it("is someone else's in someone else's settings: one person's signature never signs another's email", async () => {
    await db.execute(sql`insert into "user" (id, name, email) values ('u2', 'Marco Neri', 'marco@acme.it')
      on conflict do nothing`);
    const { html } = await composeEmail(db, { userId: "u2" }, { subject: "s", html: "<p>x</p>", signature: "full" });
    expect(html).toContain("Marco Neri");
    expect(html).not.toContain("Responsabile commerciale");
  });
});

describe("⚠️⚠️ the logo in an email", () => {
  it("is a public address signed for this workspace, which the logo route reads back", async () => {
    const { html } = await compose("{{intestazione}}<p>x</p>", "none");
    const url = html.match(/src="(https:\/\/crm\.example\.it\/api\/brand\/logo\/[^"?]+)\?v=[0-9a-f]+"/)?.[1];
    expect(url).toBeTruthy();
    expect(verifyBrandLogoToken(String(url).split("/").pop() ?? "")).toBe("t-acme");
  });

  it("a new logo is a new address, so no mail client keeps the old one", async () => {
    const before = (await loadEmailBrand(db)).logoUrl;
    await setting("brand.logo", { key: "logos/new.png", contentType: "image/png" });
    expect((await loadEmailBrand(db)).logoUrl).not.toBe(before);
  });

  it("without a logo, the company's name is drawn instead", async () => {
    await db.execute(sql`delete from workspace_setting where key = 'brand.logo'`);
    const { html } = await compose("{{intestazione}}", "none");
    expect(html).not.toContain("<img");
    expect(html).toContain("Acme S.r.l.</span>");
  });
});

describe("⚠️ an invoice's email", () => {
  const copy = {
    issuerName: "Acme S.r.l.",
    documentType: "TD01" as const,
    documentNumber: "27/2026",
    issueDate: "2026-09-30",
    total: "€ 6.100,00",
    dueDate: "2026-11-30",
    installments: [
      { dueDate: "2026-10-30", amount: "€ 3.050,00" },
      { dueDate: "2026-11-30", amount: "€ 3.050,00" },
    ],
    iban: "IT60X0542811101000000123456",
    lang: "it" as const,
  };

  it("the copy: the amount, one line per installment, and the IBAN with the invoice as reference", async () => {
    const brand = await loadEmailBrand(db);
    const html = invoiceCopyLayout(copy)("<p>Testo</p>", { brand, signature: "SIG", lang: "it" });
    expect(html).toContain("€ 6.100,00");
    expect(html).toContain("Rata 1 · 30/10/2026");
    expect(html).toContain("Rata 2 · 30/11/2026");
    expect(html).toContain("IT60 X054 2811 1010 0000 0123 456");
    expect(html).toContain("causale: Fattura 27/2026");
    // From the business: no personal signature on an invoice.
    expect(html).not.toContain("SIG");
  });

  it("⚠️ a credit note carries no bank details: there is nothing to pay", async () => {
    const brand = await loadEmailBrand(db);
    const html = invoiceCopyLayout({ ...copy, documentType: "TD04" })("<p>x</p>", { brand, signature: "", lang: "it" });
    expect(html).not.toContain("IT60 X054");
  });

  it("the reminder: overdue since when, how much, where to pay, and the sender's signature", async () => {
    const brand = await loadEmailBrand(db);
    const html = paymentReminderLayout({
      issuerName: "Acme S.r.l.",
      documentType: "TD01",
      documentNumber: "9/2026",
      issueDate: "2026-08-16",
      dueDate: "2026-09-15",
      amount: "€ 2.440,00",
      daysOverdue: 16,
      iban: "IT60X0542811101000000123456",
      lang: "en",
    })("<p>Text</p>", { brand, signature: "SIG", lang: "en" });
    expect(html).toContain("Overdue by 16 days");
    expect(html).toContain("€ 2.440,00");
    expect(html).toContain("IT60 X054 2811 1010 0000 0123 456");
    expect(html).toContain("SIG");
    expect(html).toContain("VAT IT01234567890");
  });
});

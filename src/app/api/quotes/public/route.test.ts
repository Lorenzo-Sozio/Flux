/**
 * The public quote endpoint and the signature (src/lib/quote-signature.ts): accepting is
 * signing, and whoever holds the link sees who signed but never from where.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

const db = drizzle(new PGlite(), { schema });
const requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.9", "user-agent": "Firefox" });

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: async () => true }));
// A signature landing between this request's read and its write: the quote is read open, and
// accepted by somebody else the moment after.
const race = vi.hoisted(() => ({ acceptAfterRead: false }));
vi.mock("@/lib/tenant-resolve", () => ({
  resolveTenantByProbe: async () => ({ db: raced(), tenant: { id: "t1", name: "Esempio" } }),
}));
function raced() {
  if (!race.acceptAfterRead) return db;
  const findFirst = db.query.quotes.findFirst.bind(db.query.quotes);
  return Object.assign(Object.create(db), {
    query: {
      ...db.query,
      quotes: {
        ...db.query.quotes,
        findFirst: async (...args: Parameters<typeof findFirst>) => {
          const row = await findFirst(...args);
          await db.execute(sql`update quote set status = 'accepted', signed_name = 'Primo'`);
          return row;
        },
      },
    },
  });
}
vi.mock("@/lib/seller-identity", () => ({ sellerIdentity: async () => ({ name: "Esempio" }) }));
vi.mock("@/lib/quote-events", () => ({
  announceQuoteDecision: async () => undefined,
  tellQuoteOwner: async () => undefined,
}));
vi.mock("@/lib/tenant-context", () => ({ runWithTenant: (_id: string, fn: () => unknown) => fn() }));
// No object storage here: the signature stands on its record and fingerprint.
vi.mock("@/lib/storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/storage")>()),
  getStorage: async () => {
    throw new Error("no storage in this test");
  },
}));

const { GET, POST } = await import("./route");
const { NextRequest } = await import("next/server");

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("https://crm.example/api/quotes/public", { method: "POST", body: JSON.stringify(body) }));
const get = () => GET(new NextRequest("https://crm.example/api/quotes/public?token=tok1"));
const quote = async () =>
  (await db.execute(sql`select * from quote where id = 'q1'`)).rows[0] as Record<string, string | null>;

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["quote_activity", "quote_item", "quote", "deal", "company"])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`insert into company (id, name) values ('co1', 'Bar Roma')`);
  await db.execute(sql`insert into deal (id, name, amount, company_id) values ('d1', 'Fornitura', '100', 'co1')`);
  await db.execute(sql`insert into quote (id, quote_number, deal_id, company_id, status, subtotal, total_amount, public_token)
    values ('q1', 'QT-202609-AAAA', 'd1', 'co1', 'viewed', '100', '122', 'tok1')`);
});

describe("⚠️⚠️ accepting is signing", () => {
  it("a click alone is refused with 422, and nothing changes", async () => {
    for (const body of [
      { token: "tok1", action: "accepted" },
      { token: "tok1", action: "accepted", signerName: "Mario Rossi" },
      { token: "tok1", action: "accepted", consent: true },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("signature_required");
    }
    expect((await quote()).status).toBe("viewed");
  });

  it("a name and the ticked box accept it, recorded from the address the platform saw", async () => {
    const res = await post({ token: "tok1", action: "accepted", signerName: "Mario Rossi", consent: true });
    expect(res.status).toBe(200);
    expect(await quote()).toMatchObject({
      status: "accepted",
      signed_name: "Mario Rossi",
      // The last hop, not the first address, which the client writes itself.
      signed_ip: "203.0.113.9",
      signed_user_agent: "Firefox",
      signed_pdf_key: null,
    });
    expect((await quote()).signed_pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("declining needs no signature", async () => {
    expect((await post({ token: "tok1", action: "declined", reason: "Troppo caro" })).status).toBe(200);
    expect((await quote()).status).toBe("declined");
  });
});

describe("⚠️⚠️ what the link shows about the signature", () => {
  it("who signed, never from where, with what, or where the file is", async () => {
    await post({ token: "tok1", action: "accepted", signerName: "Mario Rossi", consent: true });
    await db.execute(sql`update quote set signed_pdf_key = 'k/secret.pdf'`);
    const shown = (await (await get()).json()).quote;
    expect(shown.signedName).toBe("Mario Rossi");
    expect(shown).not.toHaveProperty("signedIp");
    expect(shown).not.toHaveProperty("signedUserAgent");
    expect(shown).not.toHaveProperty("signedPdfKey");
  });
});

describe("⚠️⚠️ security review, 27 September 2026", () => {
  it("⚠️⚠️ a decline racing a signature does not overwrite it", async () => {
    race.acceptAfterRead = true;
    try {
      expect((await post({ token: "tok1", action: "declined", reason: "No" })).status).toBe(409);
    } finally {
      race.acceptAfterRead = false;
    }
    expect(await quote()).toMatchObject({ status: "accepted", signed_name: "Primo", decline_reason: null });
  });

  it("⚠️ a first view racing a signature does not turn it back into «viewed»", async () => {
    await db.execute(sql`update quote set status = 'sent'`);
    race.acceptAfterRead = true;
    try {
      await get();
    } finally {
      race.acceptAfterRead = false;
    }
    expect((await quote()).status).toBe("accepted");
  });

  it("a decline arriving after the signature does not overwrite the accepted, signed quote", async () => {
    await post({ token: "tok1", action: "accepted", signerName: "Mario Rossi", consent: true });
    const res = await post({ token: "tok1", action: "declined", reason: "Troppo caro" });
    expect(res.status).toBe(409);
    expect(await quote()).toMatchObject({ status: "accepted", signed_name: "Mario Rossi", decline_reason: null });
  });

  it("the link shows what the page needs, never the manager's internal note or the exchange rate", async () => {
    await db.execute(sql`update quote set approval_note = 'Margine troppo basso', eur_rate = '1.1'`);
    const shown = (await (await get()).json()).quote;
    expect(shown).not.toHaveProperty("approvalNote");
    expect(shown).not.toHaveProperty("eurRate");
    expect(shown).not.toHaveProperty("ownerId");
    expect(shown).toMatchObject({ quoteNumber: "QT-202609-AAAA", totalAmount: "122.00" });
  });

  it("a request whose token is not a string is refused, not a 500", async () => {
    const res = await POST(
      new NextRequest("https://crm.example/api/quotes/public", {
        method: "POST",
        body: JSON.stringify({ token: {}, action: "declined" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

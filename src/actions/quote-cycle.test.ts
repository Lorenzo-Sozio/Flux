/**
 * The quote's life after it is sent, against a real Postgres: revisions, answers heard on
 * the phone, the owner told when the customer acts, and approval that counts every discount.
 *
 * ⚠️⚠️ A counter-offer meant typing the quote again from nothing; a yes on the phone could
 * not be recorded unless the customer had opened the link; the customer's acceptance
 * reached an integration and nobody else; and 40% off every line went out unsigned.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";
import { approvalRequiredReason, canTransition, revisionNumber } from "@/lib/quote-status";
import { readApprovalPolicy, writeApprovalPolicy } from "@/lib/workspace-preferences";

const pg = drizzle(new PGlite(), { schema });
const db = Object.assign(pg, {
  batch: async (queries: unknown[]) => {
    const out: unknown[] = [];
    for (const q of queries) out.push(await q);
    return out;
  },
});
const told: { userId: string; type: string; key?: string; params?: Record<string, unknown> }[] = [];

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", settings: null }) }));
vi.mock("@/lib/auth-guard", () => ({
  ForbiddenError: class extends Error {},
  requireCapability: async () => ({ userId: "anna", tenantRole: "editor", isPlatformStaff: false }),
  requirePlanModule: async () => undefined,
}));
vi.mock("@/lib/notify", () => ({
  notify: async (n: (typeof told)[number]) => {
    told.push(n);
  },
  notifyMany: async () => undefined,
}));
vi.mock("@/lib/quote-events", async (orig) => ({
  ...(await orig<typeof import("@/lib/quote-events")>()),
  announceQuoteDecision: async () => undefined,
  announceQuoteSent: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));

const { createQuoteRevisionAction, updateQuoteAction } = await import("./quotes");
const { tellQuoteOwner } = await import("@/lib/quote-events");

beforeAll(async () => {
  await applyTenantMigrations(pg as never);
}, 120_000);

beforeEach(async () => {
  told.length = 0;
  for (const t of ["quote_activity", "quote_item", "quote", "deal", "company", "workspace_setting"]) {
    await pg.execute(sql.raw(`delete from "${t}"`));
  }
  await pg.execute(sql`delete from "user"`);
  await pg.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it')`);
  await pg.execute(sql`insert into company (id, name) values ('c1', 'Rossi')`);
  await pg.execute(sql`insert into deal (id, name, company_id) values ('d1', 'Rinnovo', 'c1')`);
  await pg.execute(sql`
    insert into quote (id, quote_number, deal_id, company_id, owner_id, status, version, subtotal, total_amount, notes)
    values ('q1', 'QT-202609-AB12', 'd1', 'c1', 'anna', 'sent', 1, '100', '122', 'Consegna in 10 giorni')`);
  await pg.execute(sql`
    insert into quote_item (id, quote_id, description, quantity, unit_price, total_price, discount_percent)
    values ('i1', 'q1', 'Canone', 1, '100', '100', '5')`);
});

describe("⚠️⚠️ a new revision", () => {
  it("copies the quote and its lines as a draft at the next version, and supersedes the old one", async () => {
    const { quoteId, quoteNumber } = await createQuoteRevisionAction("q1");

    expect(quoteNumber).toBe("QT-202609-AB12-R2");
    const [fresh] = (
      await pg.execute(sql`select status, version, notes, owner_id, public_token from quote where id = ${quoteId}`)
    ).rows as Record<string, unknown>[];
    expect(fresh).toMatchObject({ status: "draft", version: 2, notes: "Consegna in 10 giorni", owner_id: "anna" });
    expect(fresh.public_token).toBeTruthy();
    const [old] = (await pg.execute(sql`select status, public_token from quote where id = 'q1'`)).rows as Record<
      string,
      unknown
    >[];
    expect(old.status).toBe("superseded");
    // A new link for the new document: the old one must not answer for it.
    expect(old.public_token).not.toBe(fresh.public_token);
    const lines = (
      await pg.execute(sql`select description, discount_percent from quote_item where quote_id = ${quoteId}`)
    ).rows;
    expect(lines).toEqual([{ description: "Canone", discount_percent: "5.00" }]);
  });

  it("is refused for a quote that has not left, or has already been accepted", async () => {
    await pg.execute(sql`update quote set status = 'draft'`);
    await expect(createQuoteRevisionAction("q1")).rejects.toThrow();
    await pg.execute(sql`update quote set status = 'accepted'`);
    await expect(createQuoteRevisionAction("q1")).rejects.toThrow();
  });

  it("numbers a revision of a revision from the original", () => {
    expect(revisionNumber("QT-202609-AB12-R2", 3)).toBe("QT-202609-AB12-R3");
    expect(canTransition("superseded", "sent")).toBe(false);
  });
});

describe("an answer heard on the phone", () => {
  it("⚠️ is recorded from `sent`, and a decline keeps the reason", async () => {
    await updateQuoteAction("q1", { status: "declined", declineReason: "  Prezzo troppo alto " });
    const [row] = (await pg.execute(sql`select status, decline_reason from quote where id = 'q1'`)).rows;
    expect(row).toEqual({ status: "declined", decline_reason: "Prezzo troppo alto" });
  });
});

describe("⚠️⚠️ what was sent does not change under the customer", () => {
  it("lines, notes and expiry of a sent quote are refused; the status still moves", async () => {
    for (const change of [
      { notes: "Consegna in 2 giorni" },
      { items: [{ description: "Canone", quantity: 1, unitPrice: 50 }] },
      { expiresAt: "2027-01-01" },
    ]) {
      await expect(updateQuoteAction("q1", change as never)).rejects.toThrow(/draft/i);
    }
    const [row] = (await pg.execute(sql`select notes, total_amount from quote where id = 'q1'`)).rows;
    expect(row).toEqual({ notes: "Consegna in 10 giorni", total_amount: "122.00" });
  });

  it("a draft is still edited", async () => {
    await pg.execute(sql`update quote set status = 'draft'`);
    await updateQuoteAction("q1", { notes: "Consegna in 2 giorni" });
    const [row] = (await pg.execute(sql`select notes from quote where id = 'q1'`)).rows;
    expect(row).toEqual({ notes: "Consegna in 2 giorni" });
  });
});

describe("⚠️⚠️ the owner is told when the customer acts", () => {
  it("on opening, accepting and declining — with the reason", async () => {
    const quote = { id: "q1", quoteNumber: "QT-1", ownerId: "anna" };
    await tellQuoteOwner(quote, "viewed");
    await tellQuoteOwner(quote, "accepted");
    await tellQuoteOwner(quote, "declined", "Prezzo");
    expect(told.map((n) => [n.type, n.key])).toEqual([
      ["quote_viewed", "quoteViewed"],
      ["quote_accepted", "quoteAccepted"],
      ["quote_declined", "quoteDeclined"],
    ]);
    expect(told[2].params).toMatchObject({ hasReason: "yes", reason: "Prezzo" });
  });

  it("from the public page itself, on the first opening and on the answer", async () => {
    const { readFileSync } = await import("node:fs");
    // The opening is read by src/lib/quote-public.ts, the answer by the route.
    expect(readFileSync("src/lib/quote-public.ts", "utf8")).toContain('tellQuoteOwner(quote, "viewed")');
    expect(readFileSync("src/app/api/quotes/public/route.ts", "utf8")).toContain("tellQuoteOwner(quote, action,");
  });

  it("nobody, for a quote with no owner", async () => {
    await tellQuoteOwner({ id: "q1", quoteNumber: "QT-1", ownerId: null }, "accepted");
    expect(told).toEqual([]);
  });
});

describe("⚠️⚠️ approval", () => {
  it("counts a line discount as well as the header's", () => {
    const policy = { maxDiscountPercent: 20, maxTotalAmount: 0 };
    expect(approvalRequiredReason({ discountPercent: 0 }, policy, [{ discountPercent: 40 }])).toMatch(
      /line discount of 40%/,
    );
    expect(approvalRequiredReason({ discountPercent: 0 }, policy, [{ discountPercent: 10 }])).toBeNull();
  });

  it("reads the workspace's own threshold, falling back to the old platform setting", async () => {
    const platform = JSON.stringify({ quoteApproval: { maxDiscountPercent: 15 } });
    expect((await readApprovalPolicy(pg as never, platform)).maxDiscountPercent).toBe(15);
    await writeApprovalPolicy(pg as never, { maxDiscountPercent: 30, maxTotalAmount: 5000 });
    expect(await readApprovalPolicy(pg as never, platform)).toEqual({ maxDiscountPercent: 30, maxTotalAmount: 5000 });
  });
});

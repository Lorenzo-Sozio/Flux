/**
 * Renewal notices from the daily job.
 *
 * ⚠️ Two silent failures: the notice that never goes out, and the notice that
 * goes out every morning for a month until somebody turns notifications off.
 * The fake database evaluates the WHERE conditions, so the claim is tested for
 * what it does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cond =
  | { op: "eq"; col: string; val: unknown }
  | { op: "ne"; col: string; val: unknown }
  | { op: "isNull"; col: string }
  | { op: "and" | "or"; parts: Cond[] };

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  ne: (col: string, val: unknown) => ({ op: "ne", col, val }),
  isNull: (col: string) => ({ op: "isNull", col }),
  and: (...parts: Cond[]) => ({ op: "and", parts }),
  or: (...parts: Cond[]) => ({ op: "or", parts }),
}));

vi.mock("@/db/schema", () => {
  const cols = ["id", "title", "ownerId", "createdBy", "noticeSentFor", "status", "amount", "billingPeriod"];
  const more = ["startDate", "endDate", "autoRenew", "renewalTermMonths", "noticeDays"];
  return { contracts: Object.fromEntries([...cols, ...more].map((c) => [c, c])) };
});

type Row = Record<string, unknown>;
let rows: Row[] = [];
const notified: { userId: string; type: string; message: string }[] = [];
let failNotify = false;
let beforeClaim: (() => void) | null = null;
let writes = 0;

function matches(row: Row, c: Cond): boolean {
  switch (c.op) {
    case "eq":
      return row[c.col] === c.val;
    case "ne":
      return row[c.col] !== c.val;
    case "isNull":
      return row[c.col] == null;
    case "and":
      return c.parts.every((p) => matches(row, p));
    case "or":
      return c.parts.some((p) => matches(row, p));
  }
}

const db = {
  select: () => ({
    from: () => ({
      where: async (c: Cond) => rows.filter((r) => matches(r, c)).map((r) => ({ ...r })),
    }),
  }),
  update: () => ({
    set: (set: Row) => ({
      where: (c: Cond) => {
        const run = () => {
          writes++;
          beforeClaim?.();
          beforeClaim = null;
          const hit = rows.filter((r) => matches(r, c));
          for (const r of hit) Object.assign(r, set);
          return hit.map((r) => ({ id: r.id }));
        };
        return {
          returning: async () => run(),
          // biome-ignore lint/suspicious/noThenProperty: mimics drizzle's thenable builder
          then: (resolve: (v: unknown) => unknown) => resolve(run()),
        };
      },
    }),
  }),
};

vi.mock("@/lib/notify", () => ({
  notify: async (n: { userId: string; type: string; message: string }) => {
    if (failNotify) throw new Error("notification store unavailable");
    notified.push(n);
  },
}));

const { sendContractNotices } = await import("./contract-notices");

const contract = (r: Row = {}): Row => ({
  id: "k1",
  title: "Assistenza",
  ownerId: "anna",
  createdBy: "bruno",
  noticeSentFor: null,
  status: "active",
  amount: "1200.00",
  billingPeriod: "annual",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  autoRenew: false,
  renewalTermMonths: null,
  noticeDays: 60,
  ...r,
});

beforeEach(() => {
  rows = [];
  notified.length = 0;
  failNotify = false;
  beforeClaim = null;
  writes = 0;
});

describe("the renewal notice", () => {
  it("⚠️⚠️ tells the owner when the contract becomes due, naming the deadline", async () => {
    rows = [contract()];
    const r = await sendContractNotices(db, "2026-10-02");
    expect(r).toEqual({ due: 1, notified: 1, unowned: 0 });
    expect(notified[0]).toMatchObject({ userId: "anna", type: "contract_renewal" });
    expect(notified[0].message).toContain("2026-11-01");
  });

  it("⚠️⚠️ goes out once a term, however many mornings the job runs", async () => {
    rows = [contract()];
    await sendContractNotices(db, "2026-10-02");
    await sendContractNotices(db, "2026-10-03");
    await sendContractNotices(db, "2026-12-30");
    expect(notified).toHaveLength(1);
  });

  it("⚠️ does not write to a contract already told, on every morning after", async () => {
    // Every statement on the HTTP driver is a request. The claim alone would stop a
    // second notification, at the price of one write per told contract per day.
    rows = [contract()];
    await sendContractNotices(db, "2026-10-02");
    const afterFirst = writes;
    await sendContractNotices(db, "2026-10-03");
    await sendContractNotices(db, "2026-10-04");
    expect(writes).toBe(afterFirst);
  });

  it("⚠️⚠️ goes out again for the next term of a contract that renews itself", async () => {
    rows = [contract({ autoRenew: true, renewalTermMonths: 12 })];
    await sendContractNotices(db, "2026-10-02");
    await sendContractNotices(db, "2027-10-02");
    expect(notified).toHaveLength(2);
    expect(notified[0].message).toContain("renews itself on 2027-01-01");
  });

  it("⚠️⚠️ is sent once when two runs race for the same contract", async () => {
    rows = [contract()];
    // The other run claims the row between this run's read and its write.
    beforeClaim = () => {
      rows[0].noticeSentFor = "2026-12-31";
    };
    const r = await sendContractNotices(db, "2026-10-02");
    expect(r.notified).toBe(0);
  });

  it("⚠️⚠️ gives the claim back when the notification cannot be written, so tomorrow retries", async () => {
    rows = [contract()];
    failNotify = true;
    await expect(sendContractNotices(db, "2026-10-02")).rejects.toThrow();
    expect(rows[0].noticeSentFor).toBeNull();

    failNotify = false;
    await sendContractNotices(db, "2026-10-03");
    expect(notified).toHaveLength(1);
  });

  it("is not sent before the contract is due, or for one that is cancelled", async () => {
    rows = [contract(), contract({ id: "k2", status: "cancelled" })];
    await sendContractNotices(db, "2026-10-01");
    await sendContractNotices(db, "2026-06-01");
    expect(notified).toHaveLength(0);
    await sendContractNotices(db, "2026-10-02");
    expect(notified).toHaveLength(1);
  });

  it("falls back to whoever created the contract when it has no owner", async () => {
    rows = [contract({ ownerId: null })];
    await sendContractNotices(db, "2026-10-02");
    expect(notified[0].userId).toBe("bruno");
  });

  it("⚠️ leaves a contract with nobody to tell unmarked, so it is told once someone owns it", async () => {
    rows = [contract({ ownerId: null, createdBy: null })];
    const r = await sendContractNotices(db, "2026-10-02");
    expect(r).toEqual({ due: 1, notified: 0, unowned: 1 });
    expect(rows[0].noticeSentFor).toBeNull();
  });
});

/**
 * Who a won or lost deal was about, and the promise that no dispatch site forgets it.
 *
 * There are four places a deal can close — dragged into a terminal column, saved as won,
 * saved as lost, and closed as lost by a pipeline that has no losing column — and they were
 * written at different times by different hands. A guarantee that each of them has to
 * remember separately is a guarantee the fifth one will not have, so the last test here
 * reads the source and checks all of them at once.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({ eq: () => undefined }));
vi.mock("@/db/schema", () => ({
  contacts: { id: "id", phone: "phone", mobile: "mobile", email: "email" },
}));

const { dealReach } = await import("@/lib/deal-reach");

type Db = Parameters<typeof dealReach>[0];

/** A database that answers one `select … limit(1)` with the rows it was given. */
function db(righe: Record<string, unknown>[]): Db {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => righe }) }) }),
  } as unknown as Db;
}

const CONTATTO = { id: "c1", phone: "+390111234567", mobile: null, email: "rossi@example.it" };

describe("the person behind a deal", () => {
  it("carries the telephone number and the email, which are what both sides know", async () => {
    expect(await dealReach(db([CONTATTO]), "c1")).toEqual({
      contact: { id: "c1", phone: "+390111234567", email: "rossi@example.it" },
    });
  });

  it("falls back to the mobile, because a contact filled in on the move has only that", async () => {
    // ⚠️ Sending `phone: null` here would say "this person has no telephone" while the
    // record plainly holds one, and the receiver cannot tell the difference.
    const solo = { id: "c2", phone: null, mobile: "+393331112223", email: null };

    expect(await dealReach(db([solo]), "c2")).toEqual({
      contact: { id: "c2", phone: "+393331112223", email: null },
    });
  });

  it("says nothing when the deal has no contact, and does not fail", async () => {
    // A deal can be created without a contact, and losing one is `set null`. Both are
    // ordinary: the event still goes out, and a subscriber that needed the person has no
    // work to do.
    expect(await dealReach(db([]), null)).toEqual({});
  });

  it("says nothing when the contact has been deleted since", async () => {
    expect(await dealReach(db([]), "sparito")).toEqual({});
  });
});

/**
 * The payload literal of the `dispatchWebhook(` call starting at `inizio`.
 *
 * Walks the brackets rather than matching a shape, so it is not fooled by a payload that
 * spreads, nests or spans however many lines.
 */
function carico(src: string, inizio: number): string {
  const apertura = src.indexOf("(", inizio);
  let profondita = 0;
  for (let i = apertura; i < src.length; i++) {
    if ("([{".includes(src[i])) profondita++;
    else if (")]}".includes(src[i])) {
      profondita--;
      if (profondita === 0) return src.slice(apertura, i + 1);
    }
  }
  throw new Error("chiamata non chiusa");
}

const SORGENTI = ["src/actions/pipeline.ts", "src/actions/orders.ts"];

describe("⚠️⚠️ every place a deal closes says whose deal it was", () => {
  const siti: [string, string][] = [];
  for (const file of SORGENTI) {
    const sorgente = readFileSync(join(process.cwd(), file), "utf8");
    for (let i = sorgente.indexOf("dispatchWebhook("); i >= 0; i = sorgente.indexOf("dispatchWebhook(", i + 1)) {
      const payload = carico(sorgente, i);
      if (payload.includes('"deal.won"') || payload.includes('"deal.lost"')) siti.push([file, payload]);
    }
  }

  it("finds every closing dispatch there is", () => {
    // Five, and each one was written at a different time by a different hand: dragged into
    // a terminal column, saved as won, saved as lost, closed as lost without a losing
    // column, and an accepted quote turning into an order. If a sixth appears this number
    // moves and the author has to read the test below, which is the point of counting.
    expect(siti).toHaveLength(5);
  });

  it.each(siti.map(([f, p], n) => [n, f, p] as const))("site %i in %s carries the contact", (_n, _f, payload) => {
    expect(payload).toContain("...reach");
  });
});

describe("⚠️⚠️ an accepted quote announces the deal it wins", () => {
  const sorgente = readFileSync(join(process.cwd(), "src/actions/orders.ts"), "utf8");

  it("only when this conversion is what won it", () => {
    // The write that wins the deal is conditional (`ne(status, "won")`) and a batch does not
    // report whether it changed anything. Announcing regardless would tell every subscriber
    // that a deal closed today when it closed last month — and `webhook-retry` makes events
    // at-least-once, so a duplicate is a story someone will believe.
    expect(sorgente).toContain('if (dealPrima && dealPrima.status !== "won")');
  });
});

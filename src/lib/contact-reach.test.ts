/**
 * Who an outgoing event is about, and the promise that no dispatch site forgets it.
 *
 * A deal can close in five places and a quote is announced from two more, all written at
 * different times by different hands. A guarantee each of them has to remember separately
 * is a guarantee the next one will not have, so the last test here reads the sources and
 * checks them all at once.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({ eq: () => undefined }));
vi.mock("@/db/schema", () => ({
  contacts: { id: "id", phone: "phone", mobile: "mobile", email: "email" },
}));

const { contactReach } = await import("@/lib/contact-reach");

type Db = Parameters<typeof contactReach>[0];

/** A database that answers one `select … limit(1)` with the rows it was given. */
function db(righe: Record<string, unknown>[]): Db {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => righe }) }) }),
  } as unknown as Db;
}

describe("the person behind an event", () => {
  it("carries the telephone number and the email, which are what both sides know", async () => {
    const contatto = { phone: "+390111234567", mobile: null, email: "rossi@example.it" };

    expect(await contactReach(db([contatto]), "c1")).toEqual({
      phone: "+390111234567",
      email: "rossi@example.it",
    });
  });

  it("falls back to the mobile, because a contact filled in on the move has only that", async () => {
    // ⚠️⚠️ The copy that used to live in quote-events never did this, so a mobile-only
    // contact left the quote events with no telephone number — and where they also had no
    // email, the receiver could not place the person at all and dropped the fact.
    const solo = { phone: null, mobile: "+393331112223", email: null };

    expect(await contactReach(db([solo]), "c2")).toEqual({ phone: "+393331112223" });
  });

  it("leaves a field out rather than saying the person has none", async () => {
    // `phone: null` reads as "this person has no telephone" while the record may plainly
    // hold one. An absent key says what is true: we have nothing to offer here.
    const muto = { phone: null, mobile: null, email: "solo@example.it" };

    expect(await contactReach(db([muto]), "c3")).toEqual({ email: "solo@example.it" });
  });

  it("says nothing when the event has no contact, and does not fail", async () => {
    expect(await contactReach(db([]), null)).toEqual({});
  });

  it("says nothing when the contact has been deleted since", async () => {
    expect(await contactReach(db([]), "sparito")).toEqual({});
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

/**
 * ⚠️ Every source that dispatches one of these, not the ones we happen to remember.
 *
 * The first version of this test read two files, and a third already existed —
 * `quote-events.ts`, which announces from a lib rather than an action. A test that has to
 * be told where to look proves only that somebody remembered to tell it.
 */
const SORGENTI = ["src/actions/pipeline.ts", "src/actions/orders.ts", "src/lib/quote-events.ts"];
const EVENTI_SULLA_PERSONA = ['"deal.won"', '"deal.lost"', '"quote.sent"', '"quote.accepted"'];

describe("⚠️⚠️ every event about a person says which person", () => {
  const siti: [string, string][] = [];
  for (const file of SORGENTI) {
    const sorgente = readFileSync(join(process.cwd(), file), "utf8");
    for (let i = sorgente.indexOf("dispatchWebhook("); i >= 0; i = sorgente.indexOf("dispatchWebhook(", i + 1)) {
      const payload = carico(sorgente, i);
      if (EVENTI_SULLA_PERSONA.some((e) => payload.includes(e))) siti.push([file, payload]);
    }
  }

  it("finds every one there is", () => {
    // Five ways a deal closes — dragged into a terminal column, saved as won, saved as
    // lost, closed as lost without a losing column, an accepted quote turning into an
    // order — plus the quote leaving and the customer answering. If a new one appears this
    // number moves and the author has to read the test below, which is the point of it.
    expect(siti).toHaveLength(7);
  });

  it.each(siti.map(([f, p], n) => [n, f, p] as const))("site %i in %s carries the person", (_n, _f, payload) => {
    expect(payload).toMatch(/\.\.\.reach|\.\.\.\(await reachOf\(/);
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

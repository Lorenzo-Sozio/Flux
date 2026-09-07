/**
 * What to do about a request that has been sent twice.
 *
 * ⚠️ Every wrong answer here is expensive and none of them look like a failure.
 * Replaying a request that never finished loses an import and reports success.
 * Proceeding on one that is still running duplicates it. Replaying somebody
 * else's body under the same key reports their result as this caller's own,
 * which is the worst of the three because it is indistinguishable from working.
 *
 * The statements around this are one insert, one select and one conditional
 * update, and none of them are interesting. The decision is, so it is a pure
 * function and this is where it is pinned.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { claim, decide, hashBody, release, remember, type StoredAttempt } from "./api-idempotency";

const NOW = new Date("2026-09-07T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;

const attempt = (over: Partial<StoredAttempt> = {}): StoredAttempt => ({
  requestHash: "hash-a",
  status: "in_progress",
  response: null,
  createdAt: NOW,
  ...over,
});

describe("a key somebody already holds", () => {
  it("⚠️⚠️ refuses the same key sent with a different body", () => {
    // The worst answer available is the first body's result. It would arrive as a
    // 200 full of ids for records this caller never sent.
    expect(decide(attempt({ status: "done", response: '{"ok":true}' }), "hash-b", NOW)).toEqual({ kind: "mismatch" });
    expect(decide(attempt(), "hash-b", NOW)).toEqual({ kind: "mismatch" });
  });

  it("⚠️ replays a finished request instead of importing it again", () => {
    const stored = attempt({ status: "done", response: JSON.stringify({ summary: { created: 2 } }) });

    expect(decide(stored, "hash-a", NOW)).toEqual({ kind: "replay", body: { summary: { created: 2 } } });
  });

  it("⚠️ replays a finished request that stored nothing, rather than importing", () => {
    // A row marked done with no body is our bug. Running the import a second
    // time is not the way to make up for it.
    expect(decide(attempt({ status: "done", response: null }), "hash-a", NOW)).toEqual({ kind: "replay", body: null });
  });

  it("survives a stored body that is not readable", () => {
    expect(decide(attempt({ status: "done", response: "{ truncated" }), "hash-a", NOW)).toEqual({
      kind: "replay",
      body: null,
    });
  });

  it("⚠️ refuses while the first request could still be running", () => {
    // Proceeding here is what duplicates an import, and the window is the only
    // thing standing between a slow request and its own retry.
    expect(decide(attempt({ createdAt: NOW }), "hash-a", NOW)).toEqual({ kind: "in-flight" });
    expect(decide(attempt({ createdAt: ago(MINUTE) }), "hash-a", NOW)).toEqual({ kind: "in-flight" });
    expect(decide(attempt({ createdAt: ago(14 * MINUTE) }), "hash-a", NOW)).toEqual({ kind: "in-flight" });
  });

  it("⚠️ lets a key be taken over once nothing could still be behind it", () => {
    // Without this a handler that dies mid-flight bricks the key, and the
    // caller's obvious next move is refused for a quarter of an hour.
    expect(decide(attempt({ createdAt: ago(16 * MINUTE) }), "hash-a", NOW)).toEqual({ kind: "stale" });
    expect(decide(attempt({ createdAt: ago(24 * 60 * MINUTE) }), "hash-a", NOW)).toEqual({ kind: "stale" });
  });

  it("⚠️ never reports a stale row as a claim", () => {
    // `stale` is a reason to try for the key, not permission to act as though it
    // were held. A `Claim` here would name no key, and the answer would later be
    // written against an empty one.
    const verdict = decide(attempt({ createdAt: ago(60 * MINUTE) }), "hash-a", NOW);
    expect(verdict).not.toHaveProperty("key");
    expect(verdict.kind).toBe("stale");
  });

  it("checks the body before anything else", () => {
    // A mismatch on a row old enough to take over is still a mismatch: the key
    // being free does not make it right to answer with a different request's id.
    expect(decide(attempt({ createdAt: ago(60 * MINUTE) }), "hash-b", NOW)).toEqual({ kind: "mismatch" });
  });
});

describe("the body hash", () => {
  it("is the same for the same bytes and different for different ones", async () => {
    expect(await hashBody('{"a":1}')).toBe(await hashBody('{"a":1}'));
    expect(await hashBody('{"a":1}')).not.toBe(await hashBody('{"a":2}'));
  });

  it("⚠️ separates two bodies that differ only in key order", async () => {
    // Which is why the route hashes the raw text rather than re-serialising what
    // it parsed: two callers sending the same fields in a different order are
    // sending different requests as far as this is concerned, and treating them
    // as the same would replay one caller's ids to the other.
    expect(await hashBody('{"a":1,"b":2}')).not.toBe(await hashBody('{"b":2,"a":1}'));
  });

  it("is hex, and the length SHA-256 produces", async () => {
    const digest = await hashBody("anything");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * A stand-in for the table, honouring the one thing that matters: an insert whose
 * key is already present writes nothing and returns nothing.
 *
 * ⚠️ It returns a real Promise carrying a `returning` property, because `claim`
 * asks for the inserted rows and `remember` does not await anything back. A
 * double that only offered one shape would make one of them throw, and the
 * `catch` around the caller would eat it.
 */
function fakeTable(initial: (StoredAttempt & { key: string }) | null = null) {
  const state = {
    row: initial,
    /** The row disappears between the insert and the select. */
    hideOnRead: false,
    /** Whether the conditional swap finds its row. */
    swapWins: true,
    deleted: 0,
  };

  const thenable = <T>(value: T) => {
    const p = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<T> };
    p.returning = async () => value;
    return p;
  };

  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (state.row) return [];
            state.row = v as unknown as StoredAttempt & { key: string };
            return [{ key: v.key }];
          },
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: async () => (state.row && !state.hideOnRead ? [state.row] : []) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          if (!state.swapWins) return thenable([]);
          if (state.row) state.row = { ...state.row, ...(v as object) } as StoredAttempt & { key: string };
          return thenable([{ key: state.row?.key ?? "" }]);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.deleted++;
        state.row = null;
      },
    }),
  };

  // biome-ignore lint/suspicious/noExplicitAny: a double stands in for a drizzle handle
  return { db: db as any, state };
}

describe("claiming a key", () => {
  it("does nothing at all when no key was sent", async () => {
    const { db, state } = fakeTable();

    expect(await claim(db, "/api/crm/contacts/bulk", null, "hash-a", NOW)).toEqual({ kind: "unkeyed" });
    expect(await claim(db, "/api/crm/contacts/bulk", "   ", "hash-a", NOW)).toEqual({ kind: "unkeyed" });
    expect(state.row).toBeNull();
  });

  it("the first request gets the key", async () => {
    const { db, state } = fakeTable();

    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW)).toEqual({
      kind: "proceed",
      key: "k1",
      endpoint: "/api/crm/contacts/bulk",
    });
    expect(state.row?.status).toBe("in_progress");
  });

  it("⚠️⚠️ the second request does not get it, whatever the first is doing", async () => {
    // The mutual exclusion. Reading first and then inserting would let two copies
    // of the same request both find nothing and both import.
    const { db } = fakeTable();
    await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW);

    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW)).toEqual({ kind: "in-flight" });
  });

  it("⚠️ a finished request replays, and imports nothing", async () => {
    const { db } = fakeTable();
    const first = await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW);
    await remember(db, first, { summary: { created: 3 } }, NOW);

    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW)).toEqual({
      kind: "replay",
      body: { summary: { created: 3 } },
    });
  });

  it("⚠️ the same key with a different body is refused", async () => {
    const { db } = fakeTable();
    await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW);

    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-b", NOW)).toEqual({ kind: "mismatch" });
  });

  it("⚠️ a row that vanishes between the two statements is refused, not waved through", async () => {
    // The one answer that must never come out of this is `unkeyed`, because that
    // is the state in which two imports run.
    const { db, state } = fakeTable();
    await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW);
    state.hideOnRead = true;

    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW)).toEqual({ kind: "in-flight" });
  });

  it("⚠️ takes a stale key over, but only by winning the swap", async () => {
    const { db, state } = fakeTable();
    await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW);
    const later = new Date(NOW.getTime() + 20 * MINUTE);

    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", later)).toMatchObject({ kind: "proceed" });

    // Somebody else got there first: the swap matches nothing and this request
    // stands down rather than importing alongside them.
    state.swapWins = false;
    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", later)).toEqual({ kind: "in-flight" });
  });

  it("⚠️ a released key can be used again straight away", async () => {
    // A handler that throws must not leave the caller's obvious next move
    // refused for a quarter of an hour over an import that never happened.
    const { db, state } = fakeTable();
    const first = await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW);
    await release(db, first);

    expect(state.deleted).toBe(1);
    expect(await claim(db, "/api/crm/contacts/bulk", "k1", "hash-a", NOW)).toMatchObject({ kind: "proceed" });
  });

  it("stores nothing for a request that never held the key", async () => {
    const { db, state } = fakeTable();
    await remember(db, { kind: "in-flight" }, { anything: true }, NOW);
    await release(db, { kind: "unkeyed" });

    expect(state.row).toBeNull();
    expect(state.deleted).toBe(0);
  });
});

describe("the swap that takes a stale key over", () => {
  it("⚠️ is conditional on the timestamp that was observed", () => {
    // A behavioural test cannot see this: a double cannot tell a conditional
    // `WHERE` from an unconditional one without interpreting drizzle's own
    // objects. But dropping the condition turns the takeover into a read
    // followed by a write, and two requests racing for an abandoned key would
    // both win it.
    const source = readFileSync("src/lib/api-idempotency.ts", "utf8");
    const swap = source.slice(source.indexOf("const won = await db"));
    expect(swap).toContain("eq(apiIdempotency.createdAt, row.createdAt)");
  });
});

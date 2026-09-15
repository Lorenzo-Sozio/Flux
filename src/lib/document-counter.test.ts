/**
 * Numbering that cannot give two documents the same number.
 *
 * ⚠️ These read the SQL drizzle generates rather than a fake that records calls,
 * because every guarantee here lives in that SQL: the conflict target, the `+ 1`,
 * the `RETURNING`, and a seed that compares numbers as numbers. A recording fake
 * would stay green if any of them changed.
 *
 * No database is contacted. `neon()` only builds a function; `.toSQL()` never
 * calls it.
 */
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  advanceStatement,
  formatOrderNumber,
  nextInSequence,
  ORDER_PREFIX,
  orderScope,
  orderSeed,
} from "./document-counter";

const db = drizzle(neon("postgresql://user:pass@localhost/never-contacted"));
const dialect = new PgDialect();
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the statement that advances a sequence", () => {
  const { sql: text, params } = advanceStatement(db, orderScope(2026), orderSeed(2026)).toSQL();
  const q = flat(text);

  it("⚠️⚠️ is a single insert that updates on conflict", () => {
    // One statement is atomic with or without a transaction, and the driver holds
    // no session to give a transaction to. Splitting this into a read and a write
    // is exactly the race the old `max()+1` had.
    expect(q).toMatch(/^insert into "document_counter"/);
    expect(q).toContain('on conflict ("scope") do update');
  });

  it("⚠️⚠️ adds one to what is already there, rather than writing a value it computed", () => {
    // Computing the next value in JavaScript and writing it back would reintroduce
    // the race: two callers would compute the same number.
    expect(q).toMatch(/"last_value" = "document_counter"\."last_value" \+ 1/);
  });

  it("returns the value it wrote", () => {
    expect(q).toMatch(/returning "last_value"$/);
  });

  it("is keyed by the scope it was given", () => {
    expect(params).toContain("order:2026");
  });
});

describe("the seed for a year that has never used the counter", () => {
  const compiled = dialect.sqlToQuery(orderSeed(2026));
  const q = flat(compiled.sql);

  it("⚠️⚠️ compares the numbers already issued as numbers, not as text", () => {
    // The defect this replaces. As text, the tenth thousandth order sorts first.
    expect("ORD-2026-10000" < "ORD-2026-9999").toBe(true);

    expect(q).toContain("max(cast(substring(");
    expect(q).toContain("as integer");
    expect(q).not.toMatch(/max\("order_number"\)/);
  });

  it("skips exactly the prefix, so the digits are what gets cast", () => {
    // `ORD-2026-` is nine characters; the number starts at the tenth.
    expect(q).toContain('substring("order_number" from 10)');
  });

  it("⚠️ ignores a malformed number rather than letting the cast throw", () => {
    // One hand-edited `ORD-2026-X1` would otherwise block every new order.
    expect(q).toContain('"order_number" ~');
    expect(compiled.params).toContain(`^${ORDER_PREFIX}-2026-[0-9]+$`);
  });

  it("carries on after the highest existing number, starting at 1 when there is none", () => {
    expect(q).toMatch(/coalesce\(max\(.*\), 0\) \+ 1/);
  });
});

describe("an order number", () => {
  it("reads the way people refer to it", () => {
    expect(formatOrderNumber(2026, 7)).toBe("ORD-2026-0007");
  });

  it("⚠️ keeps growing past four digits instead of wrapping or truncating", () => {
    expect(formatOrderNumber(2026, 9999)).toBe("ORD-2026-9999");
    expect(formatOrderNumber(2026, 10000)).toBe("ORD-2026-10000");
  });

  it("starts a new sequence each year", () => {
    expect(orderScope(2026)).not.toBe(orderScope(2027));
  });
});

describe("reading the value back", () => {
  function returning(value: unknown) {
    // Only the terminal `returning` result matters here; the SQL is covered above.
    const chain = {
      insert: () => chain,
      values: () => chain,
      onConflictDoUpdate: () => chain,
      returning: async () => [{ value }],
    };
    return chain;
  }

  it("hands back the number the database settled on", async () => {
    expect(await nextInSequence(returning(42), "order:2026", sql`1`)).toBe(42);
  });

  it("⚠️ refuses to issue a number it did not get", async () => {
    // Better an order that fails to save than `ORD-2026-NaN` on a customer's document.
    await expect(nextInSequence(returning(null), "order:2026", sql`1`)).rejects.toThrow(/order:2026/);
    await expect(nextInSequence(returning(0), "order:2026", sql`1`)).rejects.toThrow();
    await expect(nextInSequence(returning("abc"), "order:2026", sql`1`)).rejects.toThrow();
  });
});

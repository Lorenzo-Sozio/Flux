/**
 * One number, its spellings (decision of 27 September 2026): a number written without an
 * international prefix belongs to the workspace's country. On a real Postgres, through
 * findByContactPoint — what opt-out, the assistant, erasure and subject access all ask.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { findByContactPoint, phoneVariants, readContactPoint } from "./contact-point";

const db = drizzle(new PGlite(), { schema });
const find = async (point: string) => {
  const { email, digits } = readContactPoint(point);
  return (await findByContactPoint(db, email, digits)).contactIds.sort();
};

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from contact`);
  await db.execute(sql`delete from invoice_issuer`);
  await db.execute(sql`insert into contact (id, first_name, last_name, phone, mobile) values
    ('national', 'Mario', 'Rossi', null, '333 111 2223'),
    ('international', 'Anna', 'Bianchi', '+39 06 1234 5678', null),
    ('zeros', 'Luca', 'Verdi', '0039 347 000 1111', null),
    ('tim', 'Sara', 'Neri', '393 123 4567', null),
    ('london', 'John', 'Smith', '+44 20 7946 0000', null)`);
});

describe("⚠️⚠️ one number, whatever the spelling", () => {
  it("with and without the workspace's prefix — the case the opt-out missed", async () => {
    expect(await find("+39 333 111 2223")).toEqual(["national"]);
    expect(await find("0039 333 111 2223")).toEqual(["national"]);
    expect(await find("06 1234 5678")).toEqual(["international"]);
    expect(await find("+39 347 000 1111")).toEqual(["zeros"]);
  });

  it("⚠️ a national number starting 39 is never cut as if it had the prefix", async () => {
    expect(await find("393 123 4567")).toEqual(["tim"]);
    expect(await find("+39 393 123 4567")).toEqual(["tim"]);
    // Read as "+39" plus the rest, it would have been 1234567: somebody else's, or nobody's.
    expect(phoneVariants("3931234567", "39")).toEqual(["3931234567", "393931234567"]);
  });

  it("⚠️ a foreign number matches with its own prefix, not as one of ours", async () => {
    expect(await find("+44 20 7946 0000")).toEqual(["london"]);
    // Written without a prefix it is taken as Italian: not the London number.
    expect(await find("20 7946 0000")).toEqual([]);
  });

  it("the workspace's country decides, and a trunk zero is part of it", async () => {
    await db.execute(sql`insert into invoice_issuer (id, country) values ('workspace', 'GB')`);
    // In a British workspace, 020… is the London number written nationally.
    expect(await find("020 7946 0000")).toEqual(["london"]);
    expect(phoneVariants("+442079460000", "44")).toEqual(["442079460000", "2079460000", "02079460000"]);
  });
});

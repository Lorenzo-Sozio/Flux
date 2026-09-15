/**
 * The write a key rotation makes, read as the SQL drizzle generates.
 *
 * No database is contacted: `neon()` only builds a function and `.toSQL()` never
 * calls it. The rotation script has not been run against a real database from a
 * development machine, deliberately — the only one configured is production — so
 * this is where its one safety property is pinned.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it } from "vitest";

import { conditionalWrite } from "./key-rotation-db";

const db = drizzle(neon("postgresql://user:pass@localhost/never-contacted"));
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("rewriting a workspace's connection string", () => {
  const { sql, params } = conditionalWrite(
    db,
    { table: "tenants", column: "db_url", id: "t-1" },
    "OLD-CIPHERTEXT",
    "NEW-CIPHERTEXT",
  ).toSQL();
  const q = flat(sql);

  it("⚠️⚠️ replaces the value only while it is still the one that was read", () => {
    // Without the second condition a rotation would overwrite a value that
    // changed after it was read, with an encrypted copy of the old one.
    expect(q).toMatch(
      /^update "tenants" set "db_url" = \$1 where \("tenants"\."id" = \$2 and "tenants"\."db_url" = \$3\)/,
    );
    expect(params).toEqual(["NEW-CIPHERTEXT", "t-1", "OLD-CIPHERTEXT"]);
  });

  it("says whether it wrote, so a skipped row is counted as skipped", () => {
    expect(q).toMatch(/returning "id"$/);
  });
});

describe("rewriting an email credential", () => {
  it("⚠️⚠️ targets the column named, and guards it with its own old value", () => {
    for (const [column, sqlName] of [
      ["resend_api_key", "resend_api_key"],
      ["smtp_password", "smtp_password"],
    ] as const) {
      const { sql, params } = conditionalWrite(
        db,
        { table: "email_settings", column, id: "e-1" },
        "OLD",
        "NEW",
      ).toSQL();
      const q = flat(sql);
      expect(q).toContain(`set "${sqlName}" = $1`);
      expect(q).toContain(`"email_settings"."${sqlName}" = $3`);
      expect(params).toEqual(["NEW", "e-1", "OLD"]);
    }
  });
});

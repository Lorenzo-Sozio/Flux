/**
 * A user row never leaves the server whole.
 *
 * ⚠️⚠️ `with: { owner: true }` selects every column of the related user, and
 * whatever an action or route returns is serialised to whoever called it. That
 * row holds a secret iCal address with which anybody reads the person's private
 * calendar. Seventeen queries loaded it whole: opening a ticket sent the address
 * of every author on it, and the public quote endpoint sent the quote owner's to
 * the customer holding the link.
 *
 * Nothing about `owner: true` looks wrong, which is why this is a test and not a
 * review note. The relation names are read out of the schema rather than listed
 * here, so a relation added tomorrow under a new name is covered without anybody
 * remembering to add it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

/** Every relation name in the schema whose target is the users table. */
function relationsToUsers(): string[] {
  const schema = read("src/db/schema.ts");
  const names = [...schema.matchAll(/^\s+([a-zA-Z]+):\s*one\(users\b/gm)].map((m) => m[1]);
  return [...new Set(names)];
}

/**
 * The source with its comments blanked out, newlines kept so line numbers still
 * point at the right place. A comment explaining why `owner: true` is dangerous
 * is not an instance of it — the first run of this test flagged exactly that.
 */
function codeOnly(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/** Every TypeScript source file outside the schema and the tests. */
function sources(dir = "src", found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      sources(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (full.endsWith(".test.ts") || full === "src/db/schema.ts") continue;
    found.push(full);
  }
  return found;
}

describe("the column sets themselves", () => {
  it("⚠️⚠️ never include what must stay on the server", async () => {
    // Every relation now names one of these sets instead of writing `true`, which
    // moves the whole risk into two objects. Widening either one would reopen the
    // leak in sixteen places at once, and not one of those call sites would change.
    const { USER_SUMMARY_COLUMNS, PUBLIC_CONTACT_COLUMNS } = await import("./user-columns");
    for (const set of [USER_SUMMARY_COLUMNS, PUBLIC_CONTACT_COLUMNS]) {
      expect(Object.keys(set)).not.toEqual(expect.arrayContaining(["externalCalendarUrl"]));
      expect(Object.keys(set)).not.toEqual(expect.arrayContaining(["password"]));
      expect(Object.keys(set)).not.toEqual(expect.arrayContaining(["role"]));
    }
  });

  it("are exactly what each audience needs", async () => {
    // Pinned whole rather than by exclusion alone: a column added to the user table
    // next year is not on anybody's list of things to keep out.
    const { USER_SUMMARY_COLUMNS, PUBLIC_CONTACT_COLUMNS } = await import("./user-columns");
    expect(Object.keys(USER_SUMMARY_COLUMNS).sort()).toEqual(["email", "id", "image", "name"]);
    expect(Object.keys(PUBLIC_CONTACT_COLUMNS).sort()).toEqual(["email", "name"]);
  });
});

describe("a relation to a user", () => {
  const names = relationsToUsers();

  it("is found in the schema at all", () => {
    // If this came back empty the check below would pass by looking for nothing.
    expect(names).toEqual(expect.arrayContaining(["owner", "sender", "actor", "user"]));
  });

  it("⚠️⚠️ is never loaded whole", () => {
    const whole = new RegExp(`\\b(${names.join("|")})\\s*:\\s*true\\b`, "g");
    const offenders: string[] = [];
    for (const file of sources()) {
      const src = codeOnly(read(file));
      for (const m of src.matchAll(whole)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line}  ${m[0]}  →  { columns: USER_SUMMARY_COLUMNS }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("⚠️⚠️ reaches an outsider as a name and an address, nothing more", () => {
    // The public quote endpoint answers whoever holds the link, which is a
    // customer, not a colleague. Even the summary set is more than they need:
    // an internal id has no use outside the workspace.
    const route = read("src/app/api/quotes/public/route.ts");
    expect(route).toContain("owner: { columns: PUBLIC_CONTACT_COLUMNS }");
    expect(route).not.toContain("USER_SUMMARY_COLUMNS");
  });
});

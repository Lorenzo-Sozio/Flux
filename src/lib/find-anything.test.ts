/**
 * Finding things: the palette goes where the menu goes, and search does not care about
 * accents — against a real Postgres where it matters.
 *
 * ⚠️⚠️ Typing "calendario" or "previsione" in ⌘K went nowhere: the palette knew two
 * destinations, written by hand. And "Nicolo" did not find "Nicolò" anywhere.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { contacts } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { applyNavAccess, computeNavAccess } from "@/navigation/sidebar/filter-nav";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

import { phoneSearchPatterns } from "./contact-point";
import { buildWhereClause, CONTACT_FIELDS } from "./filter-engine";
import { matchCommands, navigationCommands, PALETTE_COMMANDS, type PaletteCommand } from "./palette-commands";
import { SEE_ALL } from "./record-visibility";
import { SEARCH_PROVIDERS } from "./search/providers";
import { fold } from "./text-match";

const editor: Actor = { userId: "u2", tenantRole: "editor", isPlatformStaff: false };
const viewer: Actor = { userId: "u1", tenantRole: "viewer", isPlatformStaff: false };
const ALL = ["crm", "sales", "marketing", "support", "automation", "reporting", "helpdesk"];

function commandsFor(actor: Actor, enabledModules = ALL) {
  return navigationCommands(applyNavAccess(sidebarItems, computeNavAccess(sidebarItems, { actor, enabledModules })));
}

/** The label a person reads: here, the key's last word, which is enough to match on. */
const LABELS: Record<string, string> = {
  calendar: "Calendario",
  forecast: "Previsione",
  products: "Prodotti",
  users: "Utenti",
};
const labelOf = (c: PaletteCommand) => (c.navTitleKey ? (LABELS[c.navTitleKey] ?? c.navTitleKey) : c.id);

describe("⚠️⚠️ the palette goes where the menu goes", () => {
  it("every section this person may open, the secondary ones included", () => {
    const urls = commandsFor(editor).map((c) => c.href);
    expect(urls).toContain("/dashboard/calendar");
    expect(urls).toContain("/dashboard/pipeline/forecast");
    // Left out of an editor's menu, found by the palette.
    expect(urls).toContain("/dashboard/sales/products");
    // What the role may not open is not a destination.
    expect(urls).not.toContain("/dashboard/users");
  });

  it("⚠️ nothing the plan locks: a row that opens the billing page reads as a broken link", () => {
    const urls = commandsFor(editor, ["crm"]).map((c) => c.href);
    expect(urls).not.toContain("/dashboard/sales/quotes");
    expect(urls).toContain("/dashboard/contacts");
  });

  it("typing the section's name, or a word people use for it, finds it", () => {
    const commands = [...PALETTE_COMMANDS, ...commandsFor(editor)];
    const allow = () => true;
    expect(matchCommands("calendario", allow, labelOf, 5, commands)[0]?.href).toBe("/dashboard/calendar");
    expect(matchCommands("previs", allow, labelOf, 5, commands)[0]?.href).toBe("/dashboard/pipeline/forecast");
    expect(matchCommands("oggi", allow, labelOf, 5, commands).map((c) => c.href)).toContain("/dashboard/crm");
  });

  it("a viewer's palette offers no administration either", () => {
    expect(commandsFor(viewer).map((c) => c.href)).not.toContain("/dashboard/settings");
  });
});

const db = drizzle(new PGlite());

describe("⚠️⚠️ accents do not decide what is found", () => {
  beforeAll(async () => {
    await applyTenantMigrations(db as never);
  }, 120_000);

  beforeEach(async () => {
    await db.execute(sql`delete from contact`);
    await db.execute(sql`delete from company`);
    await db.execute(sql`insert into company (id, name) values ('co', 'Àrredi Rossi Srl')`);
    await db.execute(sql`
      insert into contact (id, first_name, last_name, email, company_id) values
        ('c1', 'Nicolò', 'Bianchi', 'nb@example.com', 'co'),
        ('c2', 'ÉLISE', 'Durand', null, null),
        ('c3', 'Nicola', 'Verdi', null, null)`);
  });

  it("the same letters with and without their accents, in either case", async () => {
    const [row] = (await db.execute(sql`select ${fold("Nicolò ÈLITE Çà")} as a, ${fold("nicolo elite ca")} as b`))
      .rows as { a: string; b: string }[];
    expect(row.a).toBe(row.b);
  });

  it("global search: 'nicolo' finds Nicolò, 'elise' finds ÉLISE — and a contact is found by their company", async () => {
    const search = (q: string) => SEARCH_PROVIDERS.contact(db, { like: `%${q}%`, phoneLike: null, scope: SEE_ALL });
    expect((await search("nicolo")).map((h) => h.id)).toEqual(["c1"]);
    expect((await search("elise")).map((h) => h.id)).toEqual(["c2"]);
    expect((await search("nicolò bianchi")).map((h) => h.id)).toEqual(["c1"]);
    expect((await search("arredi rossi")).map((h) => h.id)).toEqual(["c1"]);
  });

  it("the list filter's 'contains' folds accents too", async () => {
    const where = buildWhereClause(
      {
        version: 1,
        logic: "AND",
        conditions: [{ id: "x", type: "condition", field: "firstName", operator: "contains", value: "nicolo" }],
      },
      CONTACT_FIELDS,
    );
    const rows = await db.select({ id: contacts.id }).from(contacts).where(where);
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("⚠️⚠️ a phone number is found however it was typed, prefix or not", () => {
  // The workspace's dialling code (Italy). A number typed "+39 333 …" or "0039 333 …" — copied
  // from WhatsApp or a signature — used to miss the same number saved as "333 …".
  const patterns = (q: string) => phoneSearchPatterns(q, "39");
  const search = async (q: string) =>
    (await SEARCH_PROVIDERS.contact(db, { like: `%${q}%`, phoneLike: patterns(q), scope: SEE_ALL }))
      .map((h) => h.id)
      .sort();

  beforeAll(async () => {
    await applyTenantMigrations(db as never);
  }, 120_000);

  beforeEach(async () => {
    await db.execute(sql`delete from contact`);
    await db.execute(sql`
      insert into contact (id, first_name, last_name, phone, mobile) values
        ('plain', 'Anna', 'Uno', null, '333 123 4567'),
        ('plus', 'Bruno', 'Due', '+39 333 1234567', null),
        ('zeros', 'Carla', 'Tre', null, '0039-333-1234567'),
        ('swiss', 'Dario', 'Quattro', '+41 79 123 45 67', null),
        ('tim', 'Elena', 'Cinque', null, '393 765 4321')`);
  });

  it("typed with +39 or 0039, it finds the number saved with or without the prefix", async () => {
    expect(await search("+39 333 1234567")).toEqual(["plain", "plus", "zeros"]);
    expect(await search("0039 333 123 4567")).toEqual(["plain", "plus", "zeros"]);
  });

  it("typed without a prefix, it finds what it always found", async () => {
    expect(await search("333 1234567")).toEqual(["plain", "plus", "zeros"]);
    // The last digits are enough — anybody's, the Swiss number ends in them too.
    expect(await search("4567")).toEqual(["plain", "plus", "swiss", "zeros"]);
  });

  it("⚠️ a foreign number is matched as written, and a national one starting 39 is never cut", async () => {
    expect(await search("+41 79 123 45 67")).toEqual(["swiss"]);
    // A TIM mobile: "393 …" without a "+" is a national number, not +39 followed by "3 …".
    expect(await search("393 765 4321")).toEqual(["tim"]);
    expect(patterns("393 765 4321")).toEqual(["%3937654321%"]);
  });

  it("a short international fragment is not cut down to almost nothing", () => {
    // "+39 33" keeps its digits: stripping the prefix would leave "33" and match half the book.
    expect(patterns("+39 333")).toEqual(["%39333%"]);
    expect(patterns("+3")).toBeNull();
  });
});

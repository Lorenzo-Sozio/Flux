/**
 * One registry of entities feeds global search, quick create and recents
 * (src/lib/entities.ts). These checks are what "a new section is findable,
 * creatable and remembered" has to mean: an entity added to the list without a
 * search provider, a translation, or a detail page that records the visit fails
 * here instead of quietly missing from three menus.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENTITIES, ENTITY_GROUPS, ENTITY_TYPES, entityDef, entityHref, entityInPlan } from "@/lib/entities";
import { CAPABILITIES } from "@/lib/permissions";
import { clearRecentRecords, RECENT_PER_TYPE, RECENT_TOTAL, type RecentRecord, trimRecent } from "@/lib/recent-records";
import { SEARCH_PROVIDERS } from "@/lib/search/providers";

const it_ = JSON.parse(readFileSync("messages/it.json", "utf8"));
const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const DASHBOARD = "src/app/(main)/dashboard";

function detailPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) detailPages(p, out);
    else if (name === "page.tsx" && /[\\/]\[id\][\\/]page\.tsx$/.test(p)) out.push(p.split("\\").join("/"));
  }
  return out;
}

describe("the entity registry", () => {
  it("lists every type exactly once, in a known group", () => {
    expect(ENTITIES.map((e) => e.type).sort()).toEqual([...ENTITY_TYPES].sort());
    for (const e of ENTITIES) expect(ENTITY_GROUPS).toContain(e.group);
  });

  it("gives every type a search provider", () => {
    for (const type of ENTITY_TYPES) expect(typeof SEARCH_PROVIDERS[type], type).toBe("function");
    expect(Object.keys(SEARCH_PROVIDERS).sort()).toEqual([...ENTITY_TYPES].sort());
  });

  it("names every type and group in both languages", () => {
    for (const messages of [it_, en]) {
      for (const type of ENTITY_TYPES) {
        const t = messages.entities.types[type];
        expect(t?.one, type).toBeTruthy();
        expect(t?.other, type).toBeTruthy();
        if (entityDef(type)?.create) expect(t?.new, type).toBeTruthy();
      }
      for (const g of ENTITY_GROUPS) expect(messages.entities.groups[g], g).toBeTruthy();
    }
  });

  it("asks only for capabilities that exist", () => {
    for (const e of ENTITIES) {
      expect(Object.keys(CAPABILITIES), e.type).toContain(e.read);
      if (e.create) expect(Object.keys(CAPABILITIES), e.type).toContain(e.create.capability);
    }
  });

  it("links to pages that exist", () => {
    const exists = (p: string) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    };
    // `/sequences/new` is served by `[id]` reading id === "new", so a last segment
    // with no folder of its own may be answered by a dynamic sibling.
    const resolves = (href: string) => {
      const path = href
        .split("?")[0]
        .replace("{id}", "[id]")
        .replace(/^\/dashboard/, DASHBOARD);
      return exists(`${path}/page.tsx`) || exists(`${path.replace(/\/[^/]+$/, "/[id]")}/page.tsx`);
    };
    for (const e of ENTITIES) {
      for (const href of [e.list, e.detail, e.create?.href].filter(Boolean) as string[]) {
        expect(resolves(href), `${e.type}: ${href}`).toBe(true);
      }
    }
  });

  it("builds a record's link, and falls back to the list with the query", () => {
    expect(entityHref("invoice", "a/b")).toBe("/dashboard/sales/invoices/a%2Fb");
    expect(entityHref("task", "t1")).toBe("/dashboard/tasks?task=t1");
    expect(entityHref("product", "p1", "vite 8")).toBe("/dashboard/sales/products?q=vite%208");
    expect(entityHref("product", "p1")).toBe("/dashboard/sales/products");
    expect(entityHref("nonsense", "x")).toBe("/dashboard");
  });

  it("hides what the plan does not include, and nothing when the plan is unknown", () => {
    const quote = entityDef("quote");
    const contact = entityDef("contact");
    if (!quote || !contact) throw new Error("registry changed");
    expect(entityInPlan(quote, ["crm"])).toBe(false);
    expect(entityInPlan(quote, ["crm", "sales"])).toBe(true);
    expect(entityInPlan(quote, null)).toBe(true);
    expect(entityInPlan(contact, [])).toBe(true);
  });

  it("records a visit on every record page", () => {
    const pages = detailPages(DASHBOARD);
    expect(pages.length).toBeGreaterThan(5);
    for (const p of pages) expect(readFileSync(p, "utf8"), p).toContain("<RecordVisit");
  });
});

describe("recent records", () => {
  const rec = (type: RecentRecord["type"], n: number): RecentRecord => ({
    type,
    id: `${type}-${n}`,
    label: `${type} ${n}`,
    url: "/x",
    at: n,
  });

  it("keeps the newest of each kind, so one busy morning does not push the rest out", () => {
    const invoices = Array.from({ length: 30 }, (_, i) => rec("invoice", 100 + i));
    const contacts = Array.from({ length: 3 }, (_, i) => rec("contact", i));
    const kept = trimRecent([...contacts, ...invoices]);
    expect(kept.filter((r) => r.type === "invoice")).toHaveLength(RECENT_PER_TYPE);
    expect(kept.filter((r) => r.type === "contact")).toHaveLength(3);
    expect(kept[0].id).toBe("invoice-129");
    expect(kept.filter((r) => r.type === "invoice").at(-1)?.id).toBe(`invoice-${130 - RECENT_PER_TYPE}`);
  });

  it("caps the whole list", () => {
    const all = ENTITY_TYPES.flatMap((t, k) => Array.from({ length: RECENT_PER_TYPE }, (_, i) => rec(t, k * 100 + i)));
    expect(all.length).toBeGreaterThan(RECENT_TOTAL);
    expect(trimRecent(all)).toHaveLength(RECENT_TOTAL);
  });

  it("does nothing without a workspace", () => {
    expect(() => clearRecentRecords(null)).not.toThrow();
  });
});

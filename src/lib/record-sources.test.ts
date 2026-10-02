/**
 * Where a customer came from, as one list (S1).
 *
 * ⚠️⚠️ A record stores the source's key and every report groups by it, so the label is the only
 * thing a rename may change; and opening a record and saving it must never erase a source the
 * form no longer offers.
 */
import { describe, expect, it } from "vitest";

import { keyForName, type RecordSource, sourceChoices, sourceLabel } from "@/lib/record-sources";

const t = (key: string) => `T:${key}`;
const list: RecordSource[] = [
  { key: "website", name: null, order: 2, isActive: true },
  { key: "ads_meta", name: "Facebook e Instagram", order: 1, isActive: true },
  { key: "fiera_2025", name: "Fiera 2025", order: 3, isActive: false },
];

describe("how a stored source reads", () => {
  it("is the workspace's name when it gave one, else the translation", () => {
    expect(sourceLabel("ads_meta", list, t)).toBe("Facebook e Instagram");
    expect(sourceLabel("website", list, t)).toBe("T:website");
  });

  it("translates what Flux writes by itself, and leaves anything else as it was written", () => {
    expect(sourceLabel("web_form", list, t)).toBe("T:web_form");
    expect(sourceLabel("Passaparola", list, t)).toBe("Passaparola");
    expect(sourceLabel(null, list, t)).toBeNull();
  });
});

describe("⚠️⚠️ what a form offers", () => {
  it("is the active sources, in their order", () => {
    expect(sourceChoices(list, null).map((s) => s.key)).toEqual(["ads_meta", "website"]);
  });

  it("keeps the record's own source when it is retired or not in the list", () => {
    expect(sourceChoices(list, "fiera_2025").map((s) => s.key)).toEqual(["ads_meta", "website", "fiera_2025"]);
    expect(sourceChoices(list, "Passaparola").at(-1)).toMatchObject({ key: "Passaparola", retired: true });
  });
});

describe("the key of a new source", () => {
  it("is its name, plain", () => {
    expect(keyForName("ADS TikTok", new Set())).toBe("ads_tiktok");
    expect(keyForName("Città più vicina", new Set())).toBe("citta_piu_vicina");
  });

  it("never takes one already used", () => {
    expect(keyForName("Website", new Set(["website"]))).toBe("website_2");
    expect(keyForName("Website", new Set(["website", "website_2"]))).toBe("website_3");
  });

  it("is still a key when the name has no letters", () => {
    expect(keyForName("???", new Set())).toMatch(/^source_[a-z0-9]+$/);
  });
});

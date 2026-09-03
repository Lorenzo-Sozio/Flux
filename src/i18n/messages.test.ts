/**
 * Keeps the translation files in step.
 *
 * The Italian file drifted 56 keys behind the English one, all of them in the
 * campaign launch dialog, and nothing anywhere reported it. Without a fallback
 * configured, next-intl renders the key path — so the failure surfaced as
 * `marketing.campaigns.launch.title` on screen, to the person about to email
 * their entire contact list (audit rilievo U-07).
 *
 * This is the cheapest possible guard: the day the two files disagree, this goes
 * red instead of a customer finding out.
 */
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import itMessages from "../../messages/it.json";
import { defaultLocale, locales } from "./config";

type Tree = Record<string, unknown>;

function flatten(node: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as Tree, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

const flatEn = flatten(en as Tree);
const flatIt = flatten(itMessages as Tree);

/**
 * Top-level ICU arguments: `{count}`, `{name}`, `{count, plural, ...}`.
 *
 * Deliberately not every `{` in the string — a plural branch like
 * `one {Propagated 1 task}` opens a brace too, and counting those compares
 * translated words rather than arguments.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
}

describe("translation files", () => {
  it("covers every locale the app offers", () => {
    expect([...locales].sort()).toEqual(["en", "it"]);
    expect(locales).toContain(defaultLocale);
  });

  it("has no key present in English but missing in Italian", () => {
    const missing = [...flatEn.keys()].filter((k) => !flatIt.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it("has no key present in Italian but missing in English", () => {
    const extra = [...flatIt.keys()].filter((k) => !flatEn.has(k)).sort();
    expect(extra).toEqual([]);
  });

  it("keeps the same placeholders in both languages", () => {
    // A translation that drops {count} renders a sentence with a hole in it, and
    // one that invents a placeholder throws at render time.
    const mismatched: string[] = [];
    for (const [key, english] of flatEn) {
      const italian = flatIt.get(key);
      if (italian === undefined) continue;
      const a = placeholders(english);
      const b = placeholders(italian);
      if (a.join(",") !== b.join(",")) mismatched.push(`${key}: en(${a}) vs it(${b})`);
    }
    expect(mismatched).toEqual([]);
  });

  it("has no empty translations", () => {
    const blank = [...flatIt.entries()].filter(([, v]) => v.trim() === "").map(([k]) => k);
    expect(blank).toEqual([]);
  });
});

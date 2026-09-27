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
import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";
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
 * Every ICU argument a message uses: `{count}`, `{name}`, `{count, plural, ...}`, and the
 * arguments inside select and plural branches.
 *
 * ⚠️ Read with the ICU parser next-intl itself uses, not a regular expression. The regex
 * took a branch body like `call {Call}` for an argument named `Call`, and missed its Italian
 * `{Attività}` because `\w` has no accented letters — so it compared translated words, and
 * called a correct translation broken.
 */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: MessageFormatElement[]) => {
    for (const n of nodes) {
      if ("value" in n && typeof n.value === "string" && n.type !== TYPE.literal) {
        names.add(n.value);
      }
      if ("options" in n) for (const option of Object.values(n.options)) walk(option.value);
      if ("children" in n) walk(n.children);
    }
  };
  try {
    walk(parse(message, { ignoreTag: true }));
  } catch {
    return [`<unparseable: ${message.slice(0, 30)}>`];
  }
  return [...names].sort();
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

describe("keys built at runtime", () => {
  /**
   * ⚠️ The checks above compare the two files against each other, so a key
   * missing from *both* passes them. That is fine while every key is written out
   * literally and TypeScript-adjacent tooling can see it — but the quote
   * follow-up composes its key from the situation it detected, as
   * `notOpenedSubject`, `expiringBody` and so on. Nothing else would notice one
   * of the sixteen going missing until next-intl threw on a customer's quote
   * page, which is the moment somebody was about to chase a real deal.
   */
  const FOLLOW_UP_KINDS = ["notOpened", "noAnswer", "expiring", "expired"];
  const FOLLOW_UP_PARTS = ["Badge", "Why", "Subject", "Body"];

  it("has every quote follow-up message, in both languages", () => {
    const expected = FOLLOW_UP_KINDS.flatMap((kind) => FOLLOW_UP_PARTS.map((part) => `quoteFollowUp.${kind}${part}`));
    const missing = expected.filter((key) => !flatEn.has(key) || !flatIt.has(key));
    expect(missing).toEqual([]);
  });

  it("states a duration on every follow-up badge", () => {
    // The badge exists to say how long: "sent 10 days ago", "expires in 2 days".
    // One without the number is a badge that says nothing.
    const badges = FOLLOW_UP_KINDS.map((kind) => `quoteFollowUp.${kind}Badge`);
    const silent = badges.filter((key) => !(flatEn.get(key) ?? "").includes("{days}"));
    expect(silent).toEqual([]);
  });

  it("has every handover verdict, in both languages", () => {
    // The panel picks its key from which side is being waited on, so a missing
    // one renders "handover.waiting.us" to an agent triaging a queue.
    const expected = ["us", "customer", "nobody"].map((side) => `handover.waiting.${side}`);
    const missing = expected.filter((key) => !flatEn.has(key) || !flatIt.has(key));
    expect(missing).toEqual([]);
  });

  it("has a word for each kind of session the minutes can contain", () => {
    // The minutes label each session from its stored type, so a missing key
    // prints "minutes.call" into a document somebody files.
    const missing = ["meeting", "call"]
      .map((kind) => `minutes.${kind}`)
      .filter((key) => !flatEn.has(key) || !flatIt.has(key));
    expect(missing).toEqual([]);
  });

  it("names the quote in every drafted subject and body", () => {
    // A follow-up that does not say which quote it is about makes the customer
    // go and look, which is the opposite of what a chase is for. The bodies do
    // not all carry {days} on purpose — "is there anything I can clarify?" reads
    // worse with a day count in it, not better.
    const drafts = FOLLOW_UP_KINDS.flatMap((kind) => [`quoteFollowUp.${kind}Subject`, `quoteFollowUp.${kind}Body`]);
    const anonymous = drafts.filter((key) => {
      for (const file of [flatEn, flatIt]) if (!(file.get(key) ?? "").includes("{quoteNumber}")) return true;
      return false;
    });
    expect(anonymous).toEqual([]);
  });
});

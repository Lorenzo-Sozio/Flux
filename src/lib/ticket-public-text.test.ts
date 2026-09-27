/** What the customer reads about their request, in both languages (src/lib/ticket-public-text.ts). */
import { describe, expect, it } from "vitest";

import { customerStatus, TICKET_TEXT } from "./ticket-public-text";

const keys = (o: object, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe("the customer's texts", () => {
  it("⚠️⚠️ every text exists in both languages, with the same placeholders", () => {
    expect(keys(TICKET_TEXT.en).sort()).toEqual(keys(TICKET_TEXT.it).sort());
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const flat = (o: object): Record<string, string> =>
      Object.fromEntries(keys(o).map((k) => [k, k.split(".").reduce((a: never, p) => a[p], o as never) as string]));
    const en = flat(TICKET_TEXT.en);
    const it_ = flat(TICKET_TEXT.it);
    for (const k of Object.keys(en)) expect(holes(it_[k]), k).toEqual(holes(en[k]));
  });

  it("names every status in the customer's words, and an unknown one as in progress", () => {
    expect(customerStatus("waiting", "en")).toBe("Waiting for your reply");
    expect(customerStatus("resolved", "it")).toBe("Risolta");
    expect(customerStatus("whatever", "en")).toBe("In progress");
  });
});

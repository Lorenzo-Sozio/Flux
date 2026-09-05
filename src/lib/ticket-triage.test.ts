/**
 * Triage from the workspace's own history.
 *
 * On the tested surface for a different reason from the rest: nothing here can
 * corrupt data, but a suggestion is followed. A confident wrong answer sets a
 * priority somebody trusts, and the failure looks exactly like the product
 * working. The two properties that matter are that it refuses when the evidence
 * disagrees, and that it never suggests from nothing.
 */
import { describe, expect, it } from "vitest";

import {
  findSimilar,
  keywords,
  type MacroCandidate,
  type PastTicket,
  similarity,
  suggestMacros,
  triage,
} from "./ticket-triage";

const past = (id: string, subject: string, extra: Partial<PastTicket> = {}): PastTicket => ({
  id,
  ticketNumber: `T-${id}`,
  subject,
  description: null,
  type: "support",
  component: null,
  priority: "normal",
  resolvedAt: new Date("2026-01-01"),
  ...extra,
});

describe("keywords", () => {
  it("drops the words every ticket contains", () => {
    expect([...keywords("Please can you help with the invoice")]).toEqual(["help", "invoice"]);
  });

  it("folds accents, so Italian matches however it is typed", () => {
    expect(keywords("però")).toEqual(keywords("pero"));
  });

  it("drops words too short to mean anything", () => {
    expect([...keywords("ok vs a printer")]).toEqual(["printer"]);
  });

  it("is empty for text with nothing in it", () => {
    expect(keywords("   the and or   ").size).toBe(0);
  });
});

describe("similarity", () => {
  it("is 1 for the same words and 0 for none in common", () => {
    expect(similarity(keywords("printer jammed"), keywords("printer jammed"))).toBe(1);
    expect(similarity(keywords("printer jammed"), keywords("invoice missing"))).toBe(0);
  });

  it("is not fooled by a long text that happens to contain a short one", () => {
    // "how many of mine appear in yours" would call this a perfect match.
    const short = keywords("printer");
    const long = keywords("printer scanner router laptop monitor keyboard docking station cable adapter");
    expect(similarity(short, long)).toBeLessThan(0.2);
  });

  it("is zero when either side has nothing to compare", () => {
    expect(similarity(new Set(), keywords("printer"))).toBe(0);
  });
});

describe("findSimilar", () => {
  const history = [
    past("1", "Printer jammed on floor two"),
    past("2", "Printer jam, paper stuck"),
    past("3", "Invoice for March is missing"),
  ];

  it("finds the tickets about the same thing", () => {
    const found = findSimilar("Printer jammed again", null, history);
    expect(found.map((f) => f.id)).toContain("1");
    expect(found.map((f) => f.id)).not.toContain("3");
  });

  it("carries the words that made it a match", () => {
    const [first] = findSimilar("Printer jammed again", null, history);
    expect(first.shared).toContain("printer");
  });

  it("never returns the ticket being triaged", () => {
    const found = findSimilar("Printer jammed on floor two", null, history, { excludeId: "1" });
    expect(found.map((f) => f.id)).not.toContain("1");
  });

  it("returns nothing for a subject with no usable words", () => {
    expect(findSimilar("the and or", null, history)).toEqual([]);
  });

  it("returns nothing when there is no history at all", () => {
    expect(findSimilar("Printer jammed", null, [])).toEqual([]);
  });
});

describe("triage", () => {
  it("suggests what the neighbours agree on", () => {
    const history = [
      past("1", "Printer jammed floor two", { priority: "high", component: "printers" }),
      past("2", "Printer jam paper stuck", { priority: "high", component: "printers" }),
    ];
    const result = triage("Printer jammed again", null, history);
    expect(result.priority?.value).toBe("high");
    expect(result.component?.value).toBe("printers");
    expect(result.priority?.from).toContain("T-1");
  });

  it("⚠️ refuses when the neighbours disagree", () => {
    // A suggestion nobody stands behind is worse than none, because it is taken.
    // The two resemble the ticket equally, so neither side carries the weight:
    // picking one would be a coin toss reported as an answer.
    const history = [
      past("1", "Printer jammed floor two", { priority: "urgent" }),
      past("2", "Printer jammed floor two", { priority: "low" }),
    ];
    const result = triage("Printer jammed again", null, history);
    expect(result.priority).toBeNull();
  });

  it("accepts two out of three, which is what agreement means", () => {
    const history = [
      past("1", "Printer jammed floor two", { priority: "high" }),
      past("2", "Printer jammed floor two", { priority: "high" }),
      past("3", "Printer jammed floor two", { priority: "low" }),
    ];
    expect(triage("Printer jammed again", null, history).priority?.value).toBe("high");
  });

  it("refuses a two-two split however similar the tickets are", () => {
    const history = [
      past("1", "Printer jammed floor two", { priority: "high" }),
      past("2", "Printer jammed floor two", { priority: "high" }),
      past("3", "Printer jammed floor two", { priority: "low" }),
      past("4", "Printer jammed floor two", { priority: "low" }),
    ];
    expect(triage("Printer jammed again", null, history).priority).toBeNull();
  });

  it("suggests nothing when nothing resembles it", () => {
    const result = triage("Printer jammed", null, [past("3", "Invoice for March is missing")]);
    expect(result.similar).toEqual([]);
    expect(result.priority).toBeNull();
    expect(result.type).toBeNull();
    expect(result.component).toBeNull();
  });

  it("ignores a neighbour that has no value to vote with", () => {
    const history = [
      past("1", "Printer jammed floor two", { component: null }),
      past("2", "Printer jam paper stuck", { component: "printers" }),
    ];
    expect(triage("Printer jammed again", null, history).component?.value).toBe("printers");
  });
});

describe("suggestMacros", () => {
  const macros: MacroCandidate[] = [
    { id: "m1", name: "Printer jam", description: "Steps for a jammed printer", body: "Open the tray…" },
    { id: "m2", name: "Invoice copy", description: "Send a duplicate invoice", body: "Attached…" },
  ];

  it("matches on what the macro is for, not on its answer", () => {
    // The body shares no vocabulary with the question, which is why it is not read.
    const found = suggestMacros("Printer jammed again", null, macros);
    expect(found[0]?.id).toBe("m1");
  });

  it("suggests nothing when no macro is about this", () => {
    expect(suggestMacros("VPN will not connect", null, macros)).toEqual([]);
  });

  it("suggests nothing when there are no macros", () => {
    expect(suggestMacros("Printer jammed", null, [])).toEqual([]);
  });
});

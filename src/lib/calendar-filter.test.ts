import { describe, expect, it } from "vitest";

import { MAX_PEOPLE, parseCalendarFilter, peopleFilter, peopleOf, personIndexFor } from "./calendar-filter";

describe("the calendar's filter in the address", () => {
  it("keeps the three named filters and the people chosen", () => {
    expect(parseCalendarFilter("mine")).toBe("mine");
    expect(parseCalendarFilter("group")).toBe("group");
    expect(parseCalendarFilter("u:anna,luca")).toBe("u:anna,luca");
  });

  it("reads anything else as everybody", () => {
    expect(parseCalendarFilter(undefined)).toBe("all");
    expect(parseCalendarFilter("")).toBe("all");
    expect(parseCalendarFilter("everyone")).toBe("all");
    expect(parseCalendarFilter("u:")).toBe("all");
  });

  it("⚠️ cleans the ids: no duplicates, nothing that is not an id, and a ceiling", () => {
    expect(peopleOf("u:anna,anna, luca ,'); drop table,")).toEqual(["anna", "luca"]);
    const many = Array.from({ length: 40 }, (_, i) => `p${i}`);
    expect(peopleOf(`u:${many.join(",")}`)).toHaveLength(MAX_PEOPLE);
    expect(peopleOf("mine")).toBeNull();
  });

  it("builds the filter back from a choice, nobody being everybody", () => {
    expect(peopleFilter(["anna", "luca"])).toBe("u:anna,luca");
    expect(peopleFilter([])).toBe("all");
  });
});

describe("a colour per person", () => {
  it("is the first chosen person involved, in the order chosen", () => {
    expect(personIndexFor(["luca", "anna"], ["anna", "luca"])).toBe(0);
    expect(personIndexFor(["luca"], ["anna", "luca"])).toBe(1);
  });

  it("is nobody's with one person on screen, or when none of them is involved", () => {
    expect(personIndexFor(["anna"], ["anna"])).toBeNull();
    expect(personIndexFor(["sara"], ["anna", "luca"])).toBeNull();
    expect(personIndexFor(["anna"], null)).toBeNull();
  });
});

/**
 * Who gets the next lead.
 *
 * ⚠️ Every mistake here looks like a working assignment: a lead given to someone
 * who left the company, a person listed twice quietly receiving double, or a
 * rotation that restarts at the top every time the team changes.
 */
import { describe, expect, it } from "vitest";

import { eligibleInOrder, isOwnedEntity, pickInTurn, roundRobinScope } from "./round-robin";

describe("taking turns", () => {
  const team = ["anna", "bruno", "carla"];

  it("goes round the list in the order configured", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((turn) => pickInTurn(team, turn))).toEqual([
      "anna",
      "bruno",
      "carla",
      "anna",
      "bruno",
      "carla",
      "anna",
    ]);
  });

  it("⚠️ gives two different turns to two different people", () => {
    // Two leads arriving together draw consecutive turns from the atomic counter.
    // The pick must not collapse consecutive turns onto one person.
    expect(pickInTurn(team, 10)).not.toBe(pickInTurn(team, 11));
  });

  it("⚠️⚠️ refuses to pick from nobody rather than assigning to undefined", () => {
    expect(() => pickInTurn([], 1)).toThrow(/Nobody is eligible/);
  });

  it("refuses a turn the counter could not have produced", () => {
    expect(() => pickInTurn(team, 0)).toThrow();
    expect(() => pickInTurn(team, 1.5)).toThrow();
  });
});

describe("who is eligible", () => {
  it("⚠️⚠️ leaves out whoever is no longer a member of the workspace", () => {
    // The rule still lists the salesperson who left. A lead handed to them is a
    // lead nobody works, sitting in their name looking assigned.
    const members = new Set(["anna", "carla"]);
    expect(eligibleInOrder(["anna", "bruno", "carla"], members)).toEqual(["anna", "carla"]);
  });

  it("⚠️ counts a person listed twice only once", () => {
    const members = new Set(["anna", "bruno"]);
    expect(eligibleInOrder(["anna", "bruno", "anna"], members)).toEqual(["anna", "bruno"]);
  });

  it("keeps the order the rule was configured in", () => {
    const members = new Set(["carla", "anna", "bruno"]);
    expect(eligibleInOrder(["bruno", "carla", "anna"], members)).toEqual(["bruno", "carla", "anna"]);
  });

  it("ignores an empty entry", () => {
    expect(eligibleInOrder(["", "anna"], new Set(["anna"]))).toEqual(["anna"]);
  });
});

describe("a rotation's own sequence", () => {
  it("is separate for each rule", () => {
    expect(roundRobinScope("rule-a")).not.toBe(roundRobinScope("rule-b"));
  });

  it("⚠️ never collides with a document numbering sequence in the same table", () => {
    expect(roundRobinScope("2026")).not.toBe("order:2026");
    expect(roundRobinScope("x").startsWith("order:")).toBe(false);
  });
});

describe("what can be assigned", () => {
  it("is the records that have an owner", () => {
    for (const t of ["lead", "contact", "company", "deal"]) expect(isOwnedEntity(t)).toBe(true);
    for (const t of ["ticket", "order", "task", ""]) expect(isOwnedEntity(t)).toBe(false);
  });
});

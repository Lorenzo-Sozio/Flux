/**
 * Figures by territory.
 *
 * ⚠️ The failures here are all totals that look plausible: records silently left
 * out, a territory missing from the table, a deal counted where its contact lives
 * while its company is elsewhere.
 */
import { describe, expect, it } from "vitest";

import type { TerritoryRule } from "./territory";
import { placeOfDeal, rollUp } from "./territory-report";

const rule = (r: Partial<TerritoryRule> & { id: string }): TerritoryRule => ({
  name: r.id,
  countries: [],
  states: [],
  postalPrefixes: [],
  ...r,
});

const nord = rule({ id: "nord", name: "Nord", countries: ["IT"], states: ["Lombardia"] });
const sud = rule({ id: "sud", name: "Sud", countries: ["IT"], states: ["Campania"] });

describe("rolling figures up", () => {
  it("⚠️⚠️ adds every address that falls in a territory into that territory", () => {
    const rows = rollUp(
      [
        { place: { country: "Italia", state: "MI" }, figures: { openLeads: "3", openValue: "1000.50" } },
        { place: { country: "IT", state: "Bergamo" }, figures: { openLeads: 2, openValue: 500 } },
        { place: { country: "IT", state: "NA" }, figures: { openLeads: 1, openValue: 10 } },
      ],
      [nord, sud],
    );
    expect(rows.find((r) => r.territoryId === "nord")?.figures).toMatchObject({ openLeads: 5, openValue: 1500.5 });
    expect(rows.find((r) => r.territoryId === "sud")?.figures).toMatchObject({ openLeads: 1, openValue: 10 });
  });

  it("⚠️⚠️ keeps records no territory covers, in their own row, last", () => {
    const rows = rollUp(
      [
        { place: { country: "FR" }, figures: { openLeads: 4 } },
        { place: {}, figures: { openLeads: 1 } },
      ],
      [nord],
    );
    const last = rows.at(-1);
    expect(last?.territoryId).toBeNull();
    expect(last?.figures.openLeads).toBe(5);
  });

  it("⚠️ lists every territory, even one with nothing in it", () => {
    const rows = rollUp([], [nord, sud]);
    expect(rows.map((r) => r.territoryId)).toEqual(["nord", "sud", null]);
    expect(rows.every((r) => r.figures.openValue === 0)).toBe(true);
  });

  it("⚠️ loses nothing: the rows add up to the input", () => {
    const input = [
      { place: { country: "IT", state: "MI" }, figures: { openDeals: 2, wonValue: 7 } },
      { place: { country: "DE" }, figures: { openDeals: 5, wonValue: 3 } },
      { place: { country: "IT", state: "SA" }, figures: { openDeals: 1, wonValue: 1 } },
    ];
    const rows = rollUp(input, [nord, sud]);
    expect(rows.reduce((s, r) => s + r.figures.openDeals, 0)).toBe(8);
    expect(rows.reduce((s, r) => s + r.figures.wonValue, 0)).toBe(11);
  });

  it("orders territories by open pipeline, largest first", () => {
    const rows = rollUp(
      [
        { place: { country: "IT", state: "MI" }, figures: { openValue: 10 } },
        { place: { country: "IT", state: "NA" }, figures: { openValue: 99 } },
      ],
      [nord, sud],
    );
    expect(rows.map((r) => r.name)).toEqual(["Sud", "Nord", null]);
  });

  it("reads a missing sum as zero", () => {
    const rows = rollUp([{ place: { country: "IT", state: "MI" }, figures: { openValue: null } }], [nord]);
    expect(rows[0].figures.openValue).toBe(0);
  });
});

describe("win rate", () => {
  it("is of the deals that closed, not of all deals", () => {
    const [row] = rollUp(
      [{ place: { country: "IT", state: "MI" }, figures: { wonDeals: 1, lostDeals: 3, openDeals: 50 } }],
      [nord],
    );
    expect(row.winRate).toBe(25);
  });

  it("⚠️ is no figure at all when nothing closed, rather than 0%", () => {
    const [row] = rollUp([{ place: { country: "IT", state: "MI" }, figures: { openDeals: 4 } }], [nord]);
    expect(row.winRate).toBeNull();
  });
});

describe("where a deal is", () => {
  it("is its company's address", () => {
    expect(placeOfDeal({ country: "IT", state: "MI" }, { country: "FR" })).toEqual({ country: "IT", state: "MI" });
  });

  it("⚠️ is its contact's when the company has no address", () => {
    expect(placeOfDeal({ country: null, state: " ", zipCode: "" }, { country: "FR" })).toEqual({ country: "FR" });
  });

  it("⚠️⚠️ never mixes the two", () => {
    // The company says Italy and nothing else; the contact is in Paris. Italy with
    // the contact's region would be a place neither of them is in.
    expect(placeOfDeal({ country: "IT" }, { country: "FR", state: "Ile-de-France" })).toEqual({ country: "IT" });
  });
});

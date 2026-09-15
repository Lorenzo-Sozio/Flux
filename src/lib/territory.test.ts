/**
 * Which territory an address falls in.
 *
 * ⚠️ Every mistake here is a record in the wrong territory or in none, and the
 * report built on it looks like a sales result rather than a matching bug.
 */
import { describe, expect, it } from "vitest";

import {
  cleanTerritory,
  countryCode,
  covers,
  fold,
  ITALIAN_PROVINCE_COUNT,
  type TerritoryRule,
  territoryOf,
} from "./territory";

const rule = (r: Partial<TerritoryRule> & { name: string }): TerritoryRule => ({
  id: r.name,
  countries: [],
  states: [],
  postalPrefixes: [],
  ...r,
});

describe("reading a typed country", () => {
  it("⚠️⚠️ takes the code, the English name and the Italian name as the same country", () => {
    for (const typed of ["IT", "it", "Italy", "Italia", " italia ", "ITA"]) expect(countryCode(typed)).toBe("IT");
    expect(countryCode("Germania")).toBe("DE");
    expect(countryCode("Deutschland")).toBe("DE");
    expect(countryCode("Svizzera")).toBe("CH");
  });

  it("knows the names people use that are not the official ones", () => {
    expect(countryCode("UK")).toBe("GB");
    expect(countryCode("Inghilterra")).toBe("GB");
    expect(countryCode("USA")).toBe("US");
    expect(countryCode("Stati Uniti")).toBe("US");
  });

  it("does not invent a country", () => {
    expect(countryCode("Narnia")).toBeNull();
    expect(countryCode("")).toBeNull();
    expect(countryCode(null)).toBeNull();
    expect(countryCode("EU"), "the European Union is not a country").toBeNull();
  });
});

describe("Italian provinces and regions", () => {
  const lombardia = rule({ name: "Lombardia", countries: ["IT"], states: ["Lombardia"] });
  const milano = rule({ name: "Milano", countries: ["IT"], states: ["MI"] });

  it("⚠️ knows all 107 provinces, plus the four old Sardinian sigle", () => {
    expect(ITALIAN_PROVINCE_COUNT).toBe(111);
  });

  it("⚠️⚠️ takes the sigla, the name and the English name as the same province", () => {
    for (const typed of ["MI", "mi", "Milano", "Milan", "MILANO "]) {
      expect(covers(milano, { country: "Italia", state: typed }), typed).toBe(true);
    }
  });

  it("⚠️⚠️ puts a province inside its region", () => {
    expect(covers(lombardia, { country: "IT", state: "MI" })).toBe(true);
    expect(covers(lombardia, { country: "IT", state: "Bergamo" })).toBe(true);
    expect(covers(lombardia, { country: "IT", state: "Lombardy" })).toBe(true);
    expect(covers(lombardia, { country: "IT", state: "TO" })).toBe(false);
  });

  it("⚠️ never puts a region inside one of its provinces", () => {
    // A record that only says "Lombardia" might be in Brescia.
    expect(covers(milano, { country: "IT", state: "Lombardia" })).toBe(false);
  });

  it("ignores accents, apostrophes and hyphens", () => {
    const romagna = rule({ name: "ER", states: ["Emilia-Romagna"] });
    expect(covers(romagna, { country: "IT", state: "Forli" })).toBe(true);
    expect(covers(romagna, { country: "IT", state: "Forlì-Cesena" })).toBe(true);
    expect(covers(rule({ name: "VdA", states: ["Valle d'Aosta"] }), { state: "valle d aosta" })).toBe(true);
    expect(fold("Reggio nell'Emilia")).toBe("REGGIO NELL EMILIA");
  });

  it("⚠️⚠️ reads a sigla as Italian only on an Italian address", () => {
    // CA is Cagliari in Italy and California in the United States.
    const sardegna = rule({ name: "Sardegna", states: ["Sardegna"] });
    expect(covers(sardegna, { country: "Italia", state: "CA" })).toBe(true);
    expect(covers(sardegna, { country: "USA", state: "CA" })).toBe(false);

    const california = rule({ name: "California", countries: ["US"], states: ["CA"] });
    expect(covers(california, { country: "USA", state: "CA" })).toBe(true);
    expect(covers(california, { country: "Italia", state: "CA" })).toBe(false);
  });

  it("matches a state outside Italy as the text typed", () => {
    const bayern = rule({ name: "Bayern", countries: ["DE"], states: ["Bayern", "Bavaria"] });
    expect(covers(bayern, { country: "Germania", state: "bavaria" })).toBe(true);
    expect(covers(bayern, { country: "Germania", state: "Hessen" })).toBe(false);
  });
});

describe("a territory's criteria", () => {
  it("⚠️⚠️ requires every criterion it has, not any of them", () => {
    const nordMilano = rule({ name: "x", countries: ["IT"], states: ["MI"], postalPrefixes: ["201"] });
    expect(covers(nordMilano, { country: "IT", state: "MI", zipCode: "20121" })).toBe(true);
    expect(covers(nordMilano, { country: "IT", state: "MI", zipCode: "20090" })).toBe(false);
    expect(covers(nordMilano, { country: "CH", state: "MI", zipCode: "20121" })).toBe(false);
  });

  it("⚠️ does not cover a record missing the field it filters on", () => {
    expect(covers(rule({ name: "x", countries: ["IT"] }), { state: "MI" })).toBe(false);
    expect(covers(rule({ name: "x", states: ["MI"] }), { country: "IT" })).toBe(false);
    expect(covers(rule({ name: "x", postalPrefixes: ["20"] }), { country: "IT" })).toBe(false);
  });

  it("⚠️⚠️ covers nothing when it has no criteria at all", () => {
    expect(covers(rule({ name: "empty" }), { country: "IT", state: "MI", zipCode: "20100" })).toBe(false);
  });

  it("reads postal codes without spaces or case", () => {
    const london = rule({ name: "London", countries: ["GB"], postalPrefixes: ["sw1"] });
    expect(covers(london, { country: "UK", zipCode: "SW1A 1AA" })).toBe(true);
    expect(covers(london, { country: "UK", zipCode: "NW1 6XE" })).toBe(false);
  });

  it("⚠️ matches the prefix at the start of the postal code, not anywhere in it", () => {
    // 12020 is in Cuneo, and has "20" in it.
    const milanoArea = rule({ name: "Milano area", countries: ["IT"], postalPrefixes: ["20"] });
    expect(covers(milanoArea, { country: "IT", zipCode: "20121" })).toBe(true);
    expect(covers(milanoArea, { country: "IT", zipCode: "12020" })).toBe(false);
  });
});

describe("choosing among overlapping territories", () => {
  const italia = rule({ name: "Italia", countries: ["IT"] });
  const nord = rule({ name: "Nord", countries: ["IT"], states: ["Lombardia", "Piemonte"] });
  const milanoCentro = rule({ name: "Milano centro", countries: ["IT"], postalPrefixes: ["2012"] });

  it("⚠️⚠️ gives the record to the narrowest territory that covers it", () => {
    const all = [italia, nord, milanoCentro];
    expect(territoryOf({ country: "IT", state: "MI", zipCode: "20121" }, all)?.name).toBe("Milano centro");
    expect(territoryOf({ country: "IT", state: "MI", zipCode: "20090" }, all)?.name).toBe("Nord");
    expect(territoryOf({ country: "IT", state: "RM" }, all)?.name).toBe("Italia");
  });

  it("⚠️ does not depend on the order the territories were loaded in", () => {
    const a = rule({ name: "Alpha", countries: ["IT"] });
    const b = rule({ name: "Beta", countries: ["IT"] });
    expect(territoryOf({ country: "IT" }, [a, b])?.name).toBe("Alpha");
    expect(territoryOf({ country: "IT" }, [b, a])?.name).toBe("Alpha");
  });

  it("is no territory when none covers the address", () => {
    expect(territoryOf({ country: "FR" }, [italia, nord])).toBeNull();
    expect(territoryOf({}, [italia])).toBeNull();
  });
});

describe("saving a territory", () => {
  it("⚠️⚠️ refuses one with no criteria", () => {
    const r = cleanTerritory({ name: "Everything", countries: [], states: [" "], postalPrefixes: [""] });
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown country code rather than storing one that never matches", () => {
    const r = cleanTerritory({ name: "x", countries: ["IT", "XX"], states: [], postalPrefixes: [] });
    expect(r).toEqual({ ok: false, error: "Not a country code: XX" });
  });

  it("refuses a nameless territory", () => {
    expect(cleanTerritory({ name: "  ", countries: ["IT"], states: [], postalPrefixes: [] }).ok).toBe(false);
  });

  it("tidies the lists: trimmed, deduplicated, codes upper case", () => {
    const r = cleanTerritory({
      name: " Nord ",
      countries: ["it", "IT"],
      states: [" MI ", "MI", ""],
      postalPrefixes: ["20 1", "201"],
    });
    expect(r).toEqual({
      ok: true,
      value: { name: "Nord", description: null, countries: ["IT"], states: ["MI"], postalPrefixes: ["201"] },
    });
  });
});

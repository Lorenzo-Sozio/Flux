/**
 * Which rotation a new record is handed out from.
 *
 * ⚠️ A wrong route is a lead in the wrong salesperson's name, which looks exactly
 * like a lead in the right one.
 */
import { describe, expect, it } from "vitest";

import { type AssignmentRoute, candidatesFor, routeScope, routeTakes } from "./assignment-routing";
import type { TerritoryRule } from "./territory";

const territory = (r: Partial<TerritoryRule> & { id: string }): TerritoryRule => ({
  name: r.id,
  countries: [],
  states: [],
  postalPrefixes: [],
  ...r,
});

const lombardia = territory({ id: "lom", countries: ["IT"], states: ["Lombardia"] });
const milanoCentro = territory({ id: "mic", countries: ["IT"], postalPrefixes: ["2012"] });
const campania = territory({ id: "cam", countries: ["IT"], states: ["Campania"] });
const TERRITORIES = [lombardia, milanoCentro, campania];

const route = (r: Partial<AssignmentRoute> & { id: string }): AssignmentRoute => ({
  territoryIds: [],
  sources: [],
  userIds: ["x"],
  ...r,
});

describe("whether a route takes a record", () => {
  it("⚠️⚠️ takes a record inside any of its territories", () => {
    const r = route({ id: "nord", territoryIds: ["lom"] });
    expect(routeTakes(r, { country: "Italia", state: "MI" }, TERRITORIES)).toBe(true);
    expect(routeTakes(r, { country: "IT", state: "NA" }, TERRITORIES)).toBe(false);
  });

  it("⚠️ takes a record even when a narrower territory also covers it", () => {
    // Milano centro is narrower, but the route asked for Lombardia and Milan is in it.
    const r = route({ id: "nord", territoryIds: ["lom"] });
    expect(routeTakes(r, { country: "IT", state: "MI", zipCode: "20121" }, TERRITORIES)).toBe(true);
  });

  it("⚠️⚠️ matches the source whatever its case or spacing", () => {
    const r = route({ id: "web", sources: ["Website"] });
    expect(routeTakes(r, { source: " website " }, TERRITORIES)).toBe(true);
    expect(routeTakes(r, { source: "referral" }, TERRITORIES)).toBe(false);
    expect(routeTakes(r, { source: null }, TERRITORIES)).toBe(false);
  });

  it("⚠️⚠️ requires both territory and source when it has both", () => {
    const r = route({ id: "nord-web", territoryIds: ["lom"], sources: ["website"] });
    expect(routeTakes(r, { country: "IT", state: "MI", source: "website" }, TERRITORIES)).toBe(true);
    expect(routeTakes(r, { country: "IT", state: "MI", source: "fair" }, TERRITORIES)).toBe(false);
    expect(routeTakes(r, { country: "IT", state: "NA", source: "website" }, TERRITORIES)).toBe(false);
  });

  it("⚠️⚠️ takes nothing when it has no criteria", () => {
    expect(routeTakes(route({ id: "empty" }), { country: "IT", state: "MI", source: "web" }, TERRITORIES)).toBe(false);
  });

  it("⚠️⚠️ takes nothing when its only territory has been deleted", () => {
    // Not everything: a deleted territory must not widen the route to every record.
    const r = route({ id: "gone", territoryIds: ["deleted"] });
    expect(routeTakes(r, { country: "IT", state: "MI" }, TERRITORIES)).toBe(false);
  });
});

describe("the order rotations are tried in", () => {
  const routes = [
    route({ id: "milano", territoryIds: ["mic"], userIds: ["carla"] }),
    route({ id: "nord", territoryIds: ["lom"], userIds: ["anna", "bruno"] }),
    route({ id: "sud", territoryIds: ["cam"], userIds: ["dario"] }),
  ];

  it("⚠️⚠️ tries matching routes in the order written, then the general rotation", () => {
    const c = candidatesFor({ country: "IT", state: "MI", zipCode: "20121" }, routes, TERRITORIES, ["zeno"]);
    expect(c.map((x) => x.routeId)).toEqual(["milano", "nord", null]);
  });

  it("goes straight to the general rotation when no route matches", () => {
    expect(candidatesFor({ country: "FR" }, routes, TERRITORIES, ["zeno"])).toEqual([
      { routeId: null, userIds: ["zeno"] },
    ]);
  });

  it("⚠️ offers nothing when no route matches and there is no general rotation", () => {
    expect(candidatesFor({ country: "FR" }, routes, TERRITORIES, [])).toEqual([]);
  });
});

describe("a route's own rotation", () => {
  it("⚠️ is separate from the general rotation and from other routes", () => {
    expect(routeScope("r1", "nord")).not.toBe(routeScope("r1", null));
    expect(routeScope("r1", "nord")).not.toBe(routeScope("r1", "sud"));
    expect(routeScope("r1", "nord")).not.toBe(routeScope("r2", "nord"));
  });

  it("⚠️⚠️ leaves the general rotation where rules written before routes existed had it", () => {
    expect(routeScope("r1", null)).toBe("round-robin:r1");
  });
});

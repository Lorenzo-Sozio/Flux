/**
 * Matching company names.
 *
 * On the tested boundary because both directions are expensive and silent. Too
 * strict and a customer ends up as two records with half the history each. Too
 * loose and two unrelated customers are merged into one, which is worse and much
 * harder to undo.
 */
import { describe, expect, it } from "vitest";

import { isSameCompanyName, normalizeCompanyName } from "./company-name";

describe("normalizeCompanyName", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(normalizeCompanyName("  ACME   Industries ")).toBe("acme industries");
    expect(normalizeCompanyName("Acme-Industries")).toBe("acme industries");
  });

  it("treats the legal form as noise", () => {
    // The case that produced two companies for one customer.
    expect(normalizeCompanyName("ACME Srl")).toBe("acme");
    expect(normalizeCompanyName("Acme S.r.l.")).toBe("acme");
    expect(normalizeCompanyName("Acme S.p.A.")).toBe("acme");
    expect(normalizeCompanyName("Acme Ltd")).toBe("acme");
    expect(normalizeCompanyName("Acme GmbH")).toBe("acme");
  });

  it("strips accents", () => {
    expect(normalizeCompanyName("Società Générale")).toBe("societa generale");
  });

  it("only strips a legal form when it stands alone", () => {
    // Without the word boundary these lose their middle: "sa" out of Sanofi,
    // "inc" out of Incotex, "co" out of Coca. That silently merges companies
    // that have nothing to do with each other.
    expect(normalizeCompanyName("Sanofi")).toBe("sanofi");
    expect(normalizeCompanyName("Incotex")).toBe("incotex");
    expect(normalizeCompanyName("Coca Cola")).toBe("coca cola");
    expect(normalizeCompanyName("Ableton")).toBe("ableton");
    expect(normalizeCompanyName("Sasol")).toBe("sasol");
  });

  it("keeps a name that is nothing but a legal form", () => {
    // Otherwise every such name normalises to "" and matches every other one.
    expect(normalizeCompanyName("SA")).toBe("sa");
    expect(normalizeCompanyName("Srl")).toBe("srl");
  });

  it("keeps names that really are different, different", () => {
    expect(normalizeCompanyName("Acme Industries")).not.toBe(normalizeCompanyName("Acme Services"));
    expect(normalizeCompanyName("Rossi")).not.toBe(normalizeCompanyName("Rossini"));
  });
});

describe("isSameCompanyName", () => {
  it("matches the spellings a person would call the same", () => {
    expect(isSameCompanyName("ACME Srl", "Acme S.r.l.")).toBe(true);
    expect(isSameCompanyName("acme  srl", "ACME")).toBe(true);
    expect(isSameCompanyName("Studio Rossi & Partners", "studio rossi and partners")).toBe(false);
  });

  it("does not match two different companies", () => {
    expect(isSameCompanyName("Sanofi", "Sano")).toBe(false);
    expect(isSameCompanyName("Acme Industries", "Acme Services")).toBe(false);
  });
});

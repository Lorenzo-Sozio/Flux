/**
 * Imposta di bollo, decided from the Natura of each line.
 *
 * ⚠️ A stamp missing where due is charged later with penalties; a stamp charged
 * where not due is the customer's money for nothing. Both are silent until audit.
 */
import { describe, expect, it } from "vitest";

import {
  assessStampDuty,
  quarterlyStampDuty,
  quarterOf,
  STAMP_LINE_DESCRIPTION,
  withStampRecharge,
} from "./stamp-duty";

const line = (over: Partial<Parameters<typeof assessStampDuty>[0][number]> = {}) => ({
  quantity: 1,
  unitPrice: 100,
  taxPercent: 0,
  nature: "N4",
  ...over,
});

describe("when the stamp is due", () => {
  it("⚠️⚠️ is due above €77.47 of VAT-free lines, and not at exactly €77.47", () => {
    expect(assessStampDuty([line({ unitPrice: 77.48 })])).toMatchObject({ due: true, base: 77.48 });
    expect(assessStampDuty([line({ unitPrice: 77.47 })])).toMatchObject({ due: false, reason: "below_threshold" });
  });

  it("⚠️⚠️ counts only the VAT-free lines, not the invoice total", () => {
    const r = assessStampDuty([line({ taxPercent: 22, nature: null, unitPrice: 5000 }), line({ unitPrice: 50 })]);
    expect(r).toMatchObject({ due: false, base: 50 });
  });

  it("⚠️ applies the document discount before comparing with the threshold", () => {
    expect(assessStampDuty([line({ unitPrice: 80 })], 10)).toMatchObject({ due: false, base: 72 });
  });

  it("⚠️⚠️ exports, San Marino, operations treated as exports and intra-EU supplies are exempt", () => {
    for (const nature of ["N3.1", "N3.2", "N3.3", "N3.4"]) {
      expect(assessStampDuty([line({ nature, unitPrice: 1000 })]), nature).toMatchObject({
        due: false,
        reason: "only_exempt_lines",
        exemptBase: 1000,
      });
    }
  });

  it("⚠️⚠️ a dichiarazione d'intento (N3.5) is NOT exempt, although non-taxable like an export", () => {
    expect(assessStampDuty([line({ nature: "N3.5", unitPrice: 1000 })])).toMatchObject({ due: true });
  });

  it("⚠️ excluded, out-of-scope and exempt operations count", () => {
    for (const nature of ["N1", "N2.1", "N2.2", "N3.6", "N4"]) {
      expect(assessStampDuty([line({ nature, unitPrice: 100 })]).due, nature).toBe(true);
    }
  });

  it("⚠️ the margin scheme (N5) shows no VAT because it is inside the price: no stamp", () => {
    expect(assessStampDuty([line({ nature: "N5", unitPrice: 1000 })])).toMatchObject({ due: false, base: 0 });
  });

  it("⚠️ an invoice mixing exempt and counted lines counts only the latter", () => {
    const r = assessStampDuty([line({ nature: "N3.1", unitPrice: 1000 }), line({ nature: "N4", unitPrice: 50 })]);
    expect(r).toMatchObject({ due: false, base: 50, exemptBase: 1000 });
  });

  it("says why when there are no VAT-free lines at all", () => {
    expect(assessStampDuty([line({ taxPercent: 22, nature: null })]).reason).toBe("no_vat_free_lines");
  });
});

describe("overriding", () => {
  it("⚠️ can force the stamp on or off, and says it was forced", () => {
    expect(assessStampDuty([line({ unitPrice: 10 })], 0, "force_on")).toMatchObject({
      due: false,
      applied: true,
      reason: "forced_on",
    });
    expect(assessStampDuty([line({ unitPrice: 1000 })], 0, "force_off")).toMatchObject({
      due: true,
      applied: false,
      reason: "forced_off",
    });
  });
});

describe("recharging the stamp to the customer", () => {
  const lines = [{ description: "Servizio esente", ...line({ unitPrice: 100 }) }];

  it("⚠️⚠️ adds one €2.00 N1 line when the stamp applies and the issuer recharges it", () => {
    const out = withStampRecharge(lines, true, true);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      description: STAMP_LINE_DESCRIPTION,
      unitPrice: 2,
      taxPercent: 0,
      nature: "N1",
      isStampRecharge: true,
    });
  });

  it("⚠️⚠️ never counts its own line towards the threshold", () => {
    // €76 of exempt services plus the €2 recharge is €78, but the recharge does not
    // make the stamp due on itself.
    const withLine = withStampRecharge([{ description: "x", ...line({ unitPrice: 76 }) }], true, true);
    expect(assessStampDuty(withLine).due).toBe(false);
  });

  it("⚠️ never adds the line twice, and removes it when the stamp stops applying", () => {
    const once = withStampRecharge(lines, true, true);
    expect(withStampRecharge(once, true, true)).toHaveLength(2);
    expect(withStampRecharge(once, false, true)).toHaveLength(1);
  });

  it("adds nothing when the issuer bears the stamp itself", () => {
    expect(withStampRecharge(lines, true, false)).toHaveLength(1);
  });
});

describe("paying it", () => {
  it("⚠️⚠️ uses the ordinary deadlines and F24 codes when every quarter is large", () => {
    const q = quarterlyStampDuty(2026, { 1: 3000, 2: 3000, 3: 10, 4: 10 });
    expect(q.map((x) => [x.f24Code, x.dueDate, x.deferred])).toEqual([
      ["2521", "2026-06-01", false], // 31 May 2026 is a Sunday
      ["2522", "2026-09-30", false],
      ["2523", "2026-11-30", false],
      ["2524", "2027-03-01", false], // 28 February 2027 is a Sunday
    ]);
  });

  it("⚠️⚠️ moves a first quarter under €5,000 to 30 September", () => {
    const q = quarterlyStampDuty(2026, { 1: 100, 2: 3000, 3: 0, 4: 0 });
    expect(q[0]).toMatchObject({ amount: 200, dueDate: "2026-09-30", deferred: true });
    expect(q[1]).toMatchObject({ dueDate: "2026-09-30", deferred: false });
  });

  it("⚠️⚠️ moves the first two quarters to 30 November when together under €5,000", () => {
    const q = quarterlyStampDuty(2026, { 1: 100, 2: 100, 3: 0, 4: 0 });
    expect(q[0]).toMatchObject({ dueDate: "2026-11-30", deferred: true });
    expect(q[1]).toMatchObject({ dueDate: "2026-11-30", deferred: true });
  });

  it("uses 29 February in a leap year", () => {
    expect(quarterlyStampDuty(2027, { 1: 0, 2: 0, 3: 0, 4: 1 })[3].dueDate).toBe("2028-02-29");
  });

  it("puts each day in its quarter", () => {
    expect(["2026-01-01", "2026-03-31", "2026-04-01", "2026-12-31"].map(quarterOf)).toEqual([1, 1, 2, 4]);
  });
});

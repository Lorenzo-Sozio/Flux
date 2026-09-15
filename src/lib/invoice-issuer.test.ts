/**
 * The issuer profile, stored in the shape FatturaPA wants.
 *
 * ⚠️ Every field here reaches an XML that SDI validates character by character.
 * A space in a partita IVA or a lower-case province is a rejected invoice.
 */
import { describe, expect, it } from "vitest";

import { issuerGaps } from "./fiscal-ids";
import { cleanIssuer } from "./invoice-issuer";

describe("cleaning the issuer profile", () => {
  it("⚠️⚠️ stores identifiers without spaces, prefix or lower case", () => {
    const p = cleanIssuer({
      vatNumber: " it 009 058 11006 ",
      fiscalCode: "rssmra85t10a562s",
      province: "mi",
      reaOffice: " mi ",
      iban: "it60 x054 2811 1010 0000 0123 456",
      taxRegime: "rf01",
    });
    expect(p).toMatchObject({
      vatNumber: "00905811006",
      fiscalCode: "RSSMRA85T10A562S",
      province: "MI",
      reaOffice: "MI",
      iban: "IT60X0542811101000000123456",
      taxRegime: "RF01",
    });
  });

  it("⚠️ turns what was typed into a profile the gap check accepts", () => {
    const p = cleanIssuer({
      legalName: " Esempio S.r.l. ",
      vatNumber: "IT 00905811006",
      taxRegime: "rf01",
      street: "Via Roma 1",
      zipCode: "20121",
      city: "Milano",
      province: "mi",
      country: "Italia",
    });
    expect(issuerGaps(p)).toEqual([]);
  });

  it("keeps an empty field empty rather than storing blanks", () => {
    const p = cleanIssuer({ legalName: "   ", iban: "", shareCapital: "" });
    expect(p.legalName).toBeNull();
    expect(p.iban).toBeNull();
    expect(p.shareCapital).toBeNull();
  });

  it("⚠️ stores the share capital with two decimals, accepting a comma", () => {
    expect(cleanIssuer({ shareCapital: "10000,5" }).shareCapital).toBe("10000.50");
    expect(cleanIssuer({ shareCapital: "-1" }).shareCapital).toBeNull();
  });

  it("drops a sole-shareholder or liquidation value FatturaPA does not define", () => {
    expect(cleanIssuer({ soleShareholder: "XX", liquidationStatus: "LN" })).toMatchObject({
      soleShareholder: null,
      liquidationStatus: "LN",
    });
  });

  it("⚠️ truncates to the lengths the XML schema allows", () => {
    expect(cleanIssuer({ legalName: "x".repeat(200) }).legalName).toHaveLength(80);
    expect(cleanIssuer({ phone: "+39 02 1234 5678 999" }).phone?.length).toBeLessThanOrEqual(12);
  });

  it("stores whether the stamp is recharged as a plain yes or no", () => {
    expect(cleanIssuer({ rechargeStampDuty: true }).rechargeStampDuty).toBe(true);
    expect(cleanIssuer({}).rechargeStampDuty).toBe(false);
  });
});

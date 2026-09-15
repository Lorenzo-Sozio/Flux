/**
 * Italian fiscal identifiers, checked against real numbers.
 *
 * ⚠️ The valid examples are public identifiers of real companies and the textbook
 * codice fiscale, not values this module computed: a test that only fed the
 * algorithm its own output would pass with the algorithm wrong.
 */
import { describe, expect, it } from "vitest";

import {
  customerGaps,
  issuerGaps,
  isValidCodiceDestinatario,
  isValidCodiceFiscale,
  isValidIban,
  isValidPartitaIva,
  normaliseVat,
} from "./fiscal-ids";

describe("partita IVA", () => {
  it("⚠️⚠️ accepts real ones", () => {
    // ENI S.p.A. and Telecom Italia S.p.A.
    expect(isValidPartitaIva("00905811006")).toBe(true);
    expect(isValidPartitaIva("00488410010")).toBe(true);
  });

  it("⚠️⚠️ refuses a wrong check digit and a transposition", () => {
    expect(isValidPartitaIva("00905811007")).toBe(false);
    expect(isValidPartitaIva("00908511006")).toBe(false);
    // Like Luhn, the check cannot see 0 and 9 swapped: "09005811006" passes. SDI
    // then refuses it as a number nobody holds, which is the most any checksum allows.
  });

  it("accepts the country prefix and spaces people type", () => {
    expect(normaliseVat(" it 00905811006 ")).toBe("00905811006");
    expect(isValidPartitaIva("IT 00905811006")).toBe(true);
  });

  it("refuses the wrong length and letters", () => {
    expect(isValidPartitaIva("0090581100")).toBe(false);
    expect(isValidPartitaIva("0090581100A")).toBe(false);
    expect(isValidPartitaIva("")).toBe(false);
  });
});

describe("codice fiscale", () => {
  it("⚠️⚠️ accepts a person's, and refuses one with the check letter changed", () => {
    expect(isValidCodiceFiscale("RSSMRA85T10A562S")).toBe(true);
    expect(isValidCodiceFiscale("rssmra85t10a562s")).toBe(true);
    expect(isValidCodiceFiscale("RSSMRA85T10A562T")).toBe(false);
  });

  it("accepts a company's, which is its partita IVA", () => {
    expect(isValidCodiceFiscale("00905811006")).toBe(true);
    expect(isValidCodiceFiscale("00905811007")).toBe(false);
  });

  it("refuses a malformed one before checking", () => {
    expect(isValidCodiceFiscale("RSSMRA85Z10A562S")).toBe(false);
    expect(isValidCodiceFiscale("RSSMRA85T10A562")).toBe(false);
  });
});

describe("delivery and payment identifiers", () => {
  it("codice destinatario is exactly seven letters or digits", () => {
    expect(isValidCodiceDestinatario("M5UXCR1")).toBe(true);
    expect(isValidCodiceDestinatario("0000000")).toBe(true);
    expect(isValidCodiceDestinatario("M5UXCR")).toBe(false);
    expect(isValidCodiceDestinatario("M5UXCR1X")).toBe(false);
  });

  it("⚠️ IBAN passes the mod-97 check", () => {
    // The Banca d'Italia sample IBAN.
    expect(isValidIban("IT60 X054 2811 1010 0000 0123 456")).toBe(true);
    expect(isValidIban("IT60X0542811101000000123457")).toBe(false);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
  });
});

const issuer = {
  legalName: "Esempio S.r.l.",
  vatNumber: "00905811006",
  taxRegime: "RF01",
  street: "Via Roma 1",
  zipCode: "20121",
  city: "Milano",
  province: "MI",
  country: "IT",
};

describe("the issuer profile", () => {
  it("is ready when complete", () => {
    expect(issuerGaps(issuer)).toEqual([]);
  });

  it("⚠️⚠️ names every missing or wrong field, not just the first", () => {
    expect(issuerGaps({ ...issuer, legalName: "", vatNumber: "00905811007", taxRegime: "RF03" })).toEqual([
      { field: "legalName", problem: "missing" },
      { field: "vatNumber", problem: "invalid" },
      { field: "taxRegime", problem: "invalid" },
    ]);
  });

  it("⚠️⚠️ wants the province sigla and a five-digit CAP on an Italian address", () => {
    expect(issuerGaps({ ...issuer, province: "Milano", zipCode: "2012" })).toEqual([
      { field: "zipCode", problem: "invalid" },
      { field: "province", problem: "invalid" },
    ]);
  });

  it("⚠️ takes the REA block whole or not at all", () => {
    expect(issuerGaps({ ...issuer, reaNumber: "123456" })).toEqual([
      { field: "reaOffice", problem: "missing" },
      { field: "liquidationStatus", problem: "missing" },
    ]);
    expect(issuerGaps({ ...issuer, reaOffice: "MI", reaNumber: "123456", liquidationStatus: "LN" })).toEqual([]);
  });

  it("checks an IBAN only when one is given", () => {
    expect(issuerGaps({ ...issuer, iban: "IT60X0542811101000000123457" })).toEqual([
      { field: "iban", problem: "invalid" },
    ]);
  });
});

const customer = {
  name: "Cliente S.p.A.",
  vatNumber: "IT00488410010",
  sdiCode: "M5UXCR1",
  street: "Corso Italia 10",
  zipCode: "10121",
  city: "Torino",
  province: "TO",
  country: "Italia",
};

describe("the customer", () => {
  it("is ready with a partita IVA and a codice destinatario", () => {
    expect(customerGaps(customer)).toEqual([]);
  });

  it("⚠️⚠️ a business must be reachable: a codice destinatario or a PEC", () => {
    expect(customerGaps({ ...customer, sdiCode: "" })).toEqual([{ field: "sdiCode", problem: "missing" }]);
    expect(customerGaps({ ...customer, sdiCode: "", pec: "fatture@pec.cliente.it" })).toEqual([]);
  });

  it("⚠️ a private person with only a codice fiscale is delivered without either", () => {
    expect(customerGaps({ ...customer, vatNumber: "", sdiCode: "", fiscalCode: "RSSMRA85T10A562S" })).toEqual([]);
  });

  it("⚠️⚠️ needs a partita IVA or a codice fiscale when Italian", () => {
    expect(customerGaps({ ...customer, vatNumber: "" })).toEqual([{ field: "vatNumber", problem: "missing" }]);
  });

  it("⚠️ a foreign customer needs neither Italian identifier nor a province", () => {
    expect(
      customerGaps({ name: "Kunde GmbH", street: "Hauptstraße 1", zipCode: "10115", city: "Berlin", country: "DE" }),
    ).toEqual([]);
  });

  it("refuses a malformed codice destinatario", () => {
    expect(customerGaps({ ...customer, sdiCode: "M5UX" })).toEqual([{ field: "sdiCode", problem: "invalid" }]);
  });
});

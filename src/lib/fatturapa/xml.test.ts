/**
 * FatturaPA XML, validated against the official schema.
 *
 * ⚠️⚠️ The schema files under ./schema are the ones published on fatturapa.gov.it
 * (Schema_VFPR12_v1.2.3.xsd, specifications 1.4) and the W3C signature schema it
 * imports, byte for byte: their hashes are pinned below. libxml2, compiled to
 * WebAssembly, does the validation — not a reading of the specification.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm";

import { TAX_REGIMES } from "../fiscal-ids";
import { NATURE_CODES } from "../invoice-rules";
import { buildFatturaPaXml, delivery, fatturaPaFileName, latin, transmissionIdFor, type XmlInvoice } from "./xml";

const DIR = "src/lib/fatturapa/schema/";
const MAIN = "Schema_VFPR12_v1.2.3.xsd";
const DSIG = "xmldsig-core-schema.xsd";
const DSIG_URL = "http://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd";

const raw = (f: string) => readFileSync(DIR + f);
/** Line endings normalised: git rewrites them on Windows, and a schema nobody touched must not fail for that. */
const normalised = (f: string) => raw(f).toString("utf8").split("\r\n").join("\n");
const mainXsd = raw(MAIN).toString("utf8").replace(/^﻿/, "");

async function validate(xml: string) {
  const result = await validateXML({
    xml: [{ fileName: "fattura.xml", contents: xml }],
    // libxml2 in WebAssembly has no network: the import points at the local copy.
    schema: [{ fileName: MAIN, contents: mainXsd.replace(DSIG_URL, DSIG) }],
    preload: [{ fileName: DSIG, contents: raw(DSIG).toString("utf8") }],
  });
  return result.errors.map((e) => e.message);
}

const issuer = {
  legalName: "Esempio S.r.l.",
  vatNumber: "00905811006",
  fiscalCode: "00905811006",
  taxRegime: "RF01",
  street: "Via Roma 1",
  zipCode: "20121",
  city: "Milano",
  province: "MI",
  country: "IT",
  reaOffice: "MI",
  reaNumber: "123456",
  shareCapital: "10000.00",
  soleShareholder: "SM",
  liquidationStatus: "LN",
  email: "amministrazione@esempio.it",
  phone: "0212345678",
  iban: "IT60X0542811101000000123456",
};

const base: XmlInvoice = {
  documentType: "TD01",
  documentNumber: "12",
  issueDate: "2026-09-15",
  currency: "EUR",
  discountPercent: 0,
  stampDuty: false,
  paymentMethod: "MP05",
  dueDate: "2026-10-15",
  notes: "Ordine ORD-2026-0001",
  issuer,
  customer: {
    name: "Cliente S.p.A.",
    vatNumber: "IT00488410010",
    sdiCode: "M5UXCR1",
    street: "Corso Italia 10",
    zipCode: "10121",
    city: "Torino",
    province: "TO",
    country: "Italia",
  },
  lines: [
    { description: "Consulenza", quantity: 10, unitPrice: 80, taxPercent: 22 },
    { description: "Licenza annuale", quantity: 1, unitPrice: 1200, discountPercent: 15, taxPercent: 22 },
  ],
  transmissionId: transmissionIdFor(2026, 12, ""),
};

describe("the official schema files", () => {
  it("⚠️⚠️ are the published ones, unchanged", () => {
    // Hashed with line endings normalised: git rewrites them on Windows, and a
    // schema nobody touched must not fail here for that.
    const sha = (f: string) => createHash("sha256").update(normalised(f)).digest("hex");
    expect(sha(MAIN)).toBe("75565fdf80b93727bdd1e4f86875b25d5dea940a708464461c1c386af7173db1");
    expect(sha(DSIG)).toBe("35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c");
  });

  it("⚠️ accept every tax regime and Natura code the product offers", () => {
    const enumOf = (type: string) => {
      const m = mainXsd.match(new RegExp(`<xs:simpleType name="${type}">([\\s\\S]*?)</xs:simpleType>`));
      return [...(m?.[1] ?? "").matchAll(/<xs:enumeration value="([^"]+)"/g)].map((x) => x[1]);
    };
    expect(enumOf("RegimeFiscaleType")).toEqual(expect.arrayContaining(Object.keys(TAX_REGIMES)));
    expect(enumOf("NaturaType")).toEqual(expect.arrayContaining(Object.keys(NATURE_CODES)));
  });
});

describe("a valid FatturaPA", () => {
  it("⚠️⚠️ for an Italian business with a codice destinatario", async () => {
    expect(await validate(buildFatturaPaXml(base))).toEqual([]);
  });

  it("⚠️⚠️ for a customer reached by PEC, with exempt lines and the stamp recharged", async () => {
    const xml = buildFatturaPaXml({
      ...base,
      stampDuty: true,
      customer: { ...base.customer, sdiCode: null, pec: "fatture@pec.cliente.it" },
      lines: [
        { description: "Prestazione sanitaria esente", quantity: 1, unitPrice: 150, taxPercent: 0, nature: "N4" },
        {
          description: "Imposta di bollo assolta in modo virtuale",
          quantity: 1,
          unitPrice: 2,
          taxPercent: 0,
          nature: "N1",
          isStampRecharge: true,
        },
      ],
    });
    expect(await validate(xml)).toEqual([]);
    expect(xml).toContain(
      "<CodiceDestinatario>0000000</CodiceDestinatario><PECDestinatario>fatture@pec.cliente.it</PECDestinatario>",
    );
    expect(xml).toContain("<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>");
  });

  it("⚠️⚠️ for a foreign business with an intra-EU supply", async () => {
    const xml = buildFatturaPaXml({
      ...base,
      customer: {
        name: "Kunde GmbH",
        vatNumber: "DE123456789",
        street: "Hauptstraße 1",
        zipCode: "10115",
        city: "Berlin",
        // Typed by somebody who filled the Italian field in anyway: a province on a
        // foreign address is rejected by the schema.
        province: "BE",
        country: "Germania",
      },
      lines: [{ description: "Macchinario", quantity: 1, unitPrice: 5000, taxPercent: 0, nature: "N3.2" }],
    });
    expect(await validate(xml)).toEqual([]);
    expect(xml).toContain("<CodiceDestinatario>XXXXXXX</CodiceDestinatario>");
    expect(xml).toContain("<IdPaese>DE</IdPaese><IdCodice>123456789</IdCodice>");
    expect(xml).toContain("<CAP>00000</CAP>");
    const customerBlock = xml.slice(xml.indexOf("<CessionarioCommittente>"));
    expect(customerBlock).not.toContain("<Provincia>");
  });

  it("⚠️ for a private person with only a codice fiscale", async () => {
    const xml = buildFatturaPaXml({
      ...base,
      customer: {
        ...base.customer,
        name: "Mario Rossi",
        vatNumber: null,
        sdiCode: null,
        fiscalCode: "RSSMRA85T10A562S",
      },
    });
    expect(await validate(xml)).toEqual([]);
    expect(xml).not.toContain("<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice></IdCodice>");
  });

  it("⚠️⚠️ with mixed rates and a document discount written as negative lines", async () => {
    const xml = buildFatturaPaXml({
      ...base,
      discountPercent: 5,
      lines: [
        { description: "Voce 22", quantity: 3, unitPrice: 33.33, taxPercent: 22 },
        { description: "Voce 10", quantity: 2.5, unitPrice: 12.345, taxPercent: 10 },
        { description: "Voce esente", quantity: 1, unitPrice: 90, taxPercent: 0, nature: "N4" },
      ],
    });
    expect(await validate(xml)).toEqual([]);
    expect(xml.match(/<Descrizione>Sconto sul documento 5%<\/Descrizione>/g)).toHaveLength(3);
  });

  it("⚠️ for a credit note referring to its invoice", async () => {
    const xml = buildFatturaPaXml({
      ...base,
      documentType: "TD04",
      originalInvoice: { documentNumber: "12", issueDate: "2026-09-15" },
    });
    expect(await validate(xml)).toEqual([]);
    expect(xml).toContain(
      "<DatiFattureCollegate><IdDocumento>12</IdDocumento><Data>2026-09-15</Data></DatiFattureCollegate>",
    );
  });

  it("⚠️⚠️ when descriptions carry characters the schema does not accept", async () => {
    const xml = buildFatturaPaXml({
      ...base,
      notes: "Grazie — “a presto” 😊",
      lines: [
        {
          description: "Servizio “premium” – €100 & più 🚀\nsu due righe",
          quantity: 1,
          unitPrice: 100,
          taxPercent: 22,
        },
      ],
    });
    expect(await validate(xml)).toEqual([]);
    // Quotes are escaped for XML, the dash and the euro sign replaced, the emoji and
    // the newline dropped: what is left is inside Latin-1.
    expect(xml).toContain("<Descrizione>Servizio &quot;premium&quot; - EUR100 &amp; più su due righe</Descrizione>");
  });

  it("⚠️ the validator itself rejects a broken document", async () => {
    const broken = buildFatturaPaXml(base).replace(
      "<RegimeFiscale>RF01</RegimeFiscale>",
      "<RegimeFiscale>RF03</RegimeFiscale>",
    );
    expect((await validate(broken)).join(" ")).toMatch(/RegimeFiscale/);
  });
});

describe("the arithmetic inside the XML", () => {
  it("⚠️⚠️ states a total equal to the sum of taxable amounts and VAT", () => {
    const xml = buildFatturaPaXml({ ...base, discountPercent: 5 });
    const nums = (tag: string) =>
      [...xml.matchAll(new RegExp(`<${tag}>([-0-9.]+)</${tag}>`, "g"))].map((m) => Number(m[1]));
    const total = Number(xml.match(/<ImportoTotaleDocumento>([0-9.]+)</)?.[1]);
    const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
    expect(sum([...nums("ImponibileImporto"), ...nums("Imposta")])).toBe(total);
    expect(Number(xml.match(/<ImportoPagamento>([0-9.]+)</)?.[1])).toBe(total);
  });
});

describe("delivery, names and identifiers", () => {
  it("delivers by code, by PEC, or abroad", () => {
    expect(delivery({ country: "IT", sdiCode: "m5uxcr1" })).toEqual({ code: "M5UXCR1", pec: null });
    expect(delivery({ country: "IT", sdiCode: "0000000", pec: "a@pec.it" })).toEqual({
      code: "0000000",
      pec: "a@pec.it",
    });
    expect(delivery({ country: "FR" })).toEqual({ code: "XXXXXXX", pec: null });
  });

  it("⚠️ keeps Italian accented letters and replaces what the schema refuses", () => {
    expect(latin("Perché è così – €5", 100)).toBe("Perché è così - EUR5");
    expect(latin("x".repeat(90), 80)).toHaveLength(80);
  });

  it("names the file IT + transmitter code + five-character progressive", () => {
    expect(fatturaPaFileName(base)).toMatch(/^IT00905811006_[A-Z0-9]{5}\.xml$/);
  });

  it("⚠️ gives different invoices different progressives, and the same invoice the same one", () => {
    expect(transmissionIdFor(2026, 12, "")).toBe(transmissionIdFor(2026, 12, ""));
    expect(transmissionIdFor(2026, 12, "")).not.toBe(transmissionIdFor(2026, 13, ""));
    expect(transmissionIdFor(2026, 12, "")).not.toBe(transmissionIdFor(2027, 12, ""));
    expect(transmissionIdFor(2026, 12, "B")).not.toBe(transmissionIdFor(2026, 12, ""));
  });
});

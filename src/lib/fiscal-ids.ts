import { countryCode, isItalianProvinceCode } from "@/lib/territory";

/**
 * Italian fiscal identifiers, and what an invoice needs from the issuer and the customer.
 *
 * ⚠️⚠️ A FatturaPA that SDI rejects comes back days later as a "scarto", and the
 * invoice legally does not exist until it is sent again. Every check here is one
 * SDI would otherwise make for us, slowly: a partita IVA with a wrong check digit,
 * a codice destinatario of six characters, a province written out in full.
 *
 * ⚠️ These checks block *issuing*, never saving a company. Records arrive from
 * imports, the API and years of typing; refusing to save them would lose data to
 * protect an invoice nobody has asked for yet.
 */

/** "IT 01234567890" → "01234567890". The country prefix is not part of the number. */
export function normaliseVat(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase().replace(/^IT/, "");
}

/** Partita IVA: eleven digits, the last a check digit over the first ten. */
export function isValidPartitaIva(value: string | null | undefined): boolean {
  const v = normaliseVat(value);
  if (!/^\d{11}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(v[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(v[10]);
}

const ODD: Record<string, number> = {
  0: 1,
  1: 0,
  2: 5,
  3: 7,
  4: 9,
  5: 13,
  6: 15,
  7: 17,
  8: 19,
  9: 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};

/**
 * Codice fiscale: sixteen characters with a check letter for a person, or eleven
 * digits for a company — where it is the same number as its partita IVA.
 *
 * Letters in place of digits (omocodia) are accepted: the check covers them too.
 */
export function isValidCodiceFiscale(value: string | null | undefined): boolean {
  const v = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (/^\d{11}$/.test(v)) return isValidPartitaIva(v);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = v[i];
    sum += i % 2 === 0 ? ODD[c] : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === v[15];
}

/** Codice destinatario for a business: seven letters or digits. "0000000" means "use the PEC, or none". */
export function isValidCodiceDestinatario(value: string | null | undefined): boolean {
  return /^[A-Z0-9]{7}$/.test((value ?? "").trim().toUpperCase());
}

export function isValidPec(value: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((value ?? "").trim());
}

/** IBAN: country, check digits, and the ISO 13616 mod-97 check over the whole. */
export function isValidIban(value: string | null | undefined): boolean {
  const v = (value ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  if (v.startsWith("IT") && v.length !== 27) return false;
  const rearranged = v.slice(4) + v.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** Regime fiscale codes accepted by FatturaPA 1.2.x. RF03 was withdrawn. */
export const TAX_REGIMES: Record<string, string> = {
  RF01: "Ordinario",
  RF02: "Contribuenti minimi",
  RF04: "Agricoltura e attività connesse e pesca",
  RF05: "Vendita sali e tabacchi",
  RF06: "Commercio fiammiferi",
  RF07: "Editoria",
  RF08: "Gestione servizi telefonia pubblica",
  RF09: "Rivendita documenti di trasporto pubblico e di sosta",
  RF10: "Intrattenimenti, giochi e altre attività",
  RF11: "Agenzie viaggi e turismo",
  RF12: "Agriturismo",
  RF13: "Vendite a domicilio",
  RF14: "Rivendita beni usati, oggetti d'arte, d'antiquariato o da collezione",
  RF15: "Agenzie di vendite all'asta di oggetti d'arte, antiquariato o da collezione",
  RF16: "IVA per cassa P.A.",
  RF17: "IVA per cassa",
  RF18: "Altro",
  RF19: "Regime forfettario",
};

export type Gap = { field: string; problem: "missing" | "invalid" };

const blank = (v: string | null | undefined) => !v || v.trim() === "";

export interface AddressFields {
  street?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
}

function addressGaps(a: AddressFields): Gap[] {
  const gaps: Gap[] = [];
  if (blank(a.street)) gaps.push({ field: "street", problem: "missing" });
  if (blank(a.city)) gaps.push({ field: "city", problem: "missing" });
  const country = countryCode(a.country);
  if (!country) {
    gaps.push({ field: "country", problem: blank(a.country) ? "missing" : "invalid" });
    return gaps;
  }
  if (country === "IT") {
    if (blank(a.zipCode)) gaps.push({ field: "zipCode", problem: "missing" });
    else if (!/^\d{5}$/.test((a.zipCode ?? "").trim())) gaps.push({ field: "zipCode", problem: "invalid" });
    // FatturaPA wants the sigla: "Milano" is rejected where "MI" is accepted.
    if (blank(a.province)) gaps.push({ field: "province", problem: "missing" });
    else if (!isItalianProvinceCode(a.province ?? "")) gaps.push({ field: "province", problem: "invalid" });
  } else if (blank(a.zipCode)) {
    gaps.push({ field: "zipCode", problem: "missing" });
  }
  return gaps;
}

export interface IssuerProfile extends AddressFields {
  legalName?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  taxRegime?: string | null;
  reaOffice?: string | null;
  reaNumber?: string | null;
  liquidationStatus?: string | null;
  iban?: string | null;
}

/** What stops this workspace issuing an invoice, field by field. Empty means ready. */
export function issuerGaps(p: IssuerProfile): Gap[] {
  const gaps: Gap[] = [];
  if (blank(p.legalName)) gaps.push({ field: "legalName", problem: "missing" });
  if (blank(p.vatNumber)) gaps.push({ field: "vatNumber", problem: "missing" });
  else if (!isValidPartitaIva(p.vatNumber)) gaps.push({ field: "vatNumber", problem: "invalid" });
  if (!blank(p.fiscalCode) && !isValidCodiceFiscale(p.fiscalCode))
    gaps.push({ field: "fiscalCode", problem: "invalid" });
  if (blank(p.taxRegime)) gaps.push({ field: "taxRegime", problem: "missing" });
  else if (!Object.hasOwn(TAX_REGIMES, p.taxRegime ?? "")) gaps.push({ field: "taxRegime", problem: "invalid" });
  gaps.push(...addressGaps(p));
  // The REA block is optional, but all-or-nothing: SDI rejects half of it.
  const rea = [p.reaOffice, p.reaNumber].some((v) => !blank(v));
  if (rea) {
    if (blank(p.reaOffice)) gaps.push({ field: "reaOffice", problem: "missing" });
    else if (!isItalianProvinceCode(p.reaOffice ?? "")) gaps.push({ field: "reaOffice", problem: "invalid" });
    if (blank(p.reaNumber)) gaps.push({ field: "reaNumber", problem: "missing" });
    if (p.liquidationStatus !== "LS" && p.liquidationStatus !== "LN") {
      gaps.push({ field: "liquidationStatus", problem: "missing" });
    }
  }
  if (!blank(p.iban) && !isValidIban(p.iban)) gaps.push({ field: "iban", problem: "invalid" });
  return gaps;
}

export interface CustomerFiscal extends AddressFields {
  name?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  sdiCode?: string | null;
  pec?: string | null;
}

/**
 * What stops an invoice being issued to this customer. Empty means ready.
 *
 * An Italian customer needs a partita IVA or a codice fiscale, and somewhere to
 * deliver: a seven-character codice destinatario, or a PEC. A foreign customer
 * is delivered with the conventional "XXXXXXX" and needs neither.
 */
export function customerGaps(c: CustomerFiscal): Gap[] {
  const gaps: Gap[] = [];
  if (blank(c.name)) gaps.push({ field: "name", problem: "missing" });
  gaps.push(...addressGaps(c));
  if (countryCode(c.country) !== "IT") return gaps;

  const hasVat = !blank(c.vatNumber);
  const hasCf = !blank(c.fiscalCode);
  if (hasVat && !isValidPartitaIva(c.vatNumber)) gaps.push({ field: "vatNumber", problem: "invalid" });
  if (hasCf && !isValidCodiceFiscale(c.fiscalCode)) gaps.push({ field: "fiscalCode", problem: "invalid" });
  if (!hasVat && !hasCf) gaps.push({ field: "vatNumber", problem: "missing" });

  const hasSdi = !blank(c.sdiCode);
  const hasPec = !blank(c.pec);
  if (hasSdi && !isValidCodiceDestinatario(c.sdiCode)) gaps.push({ field: "sdiCode", problem: "invalid" });
  if (hasPec && !isValidPec(c.pec)) gaps.push({ field: "pec", problem: "invalid" });
  // A private person with no PEC is delivered to their cassetto fiscale with 0000000;
  // a business has to be reachable.
  if (!hasSdi && !hasPec && hasVat) gaps.push({ field: "sdiCode", problem: "missing" });
  return gaps;
}

import { normaliseVat } from "@/lib/fiscal-ids";

/**
 * The issuer profile as it is stored: typed the way people type it, kept the way
 * FatturaPA wants it.
 *
 * Saving an incomplete profile is allowed — somebody fills it in over a week — and
 * `issuerGaps` says what still stops an invoice. Saving it in the wrong *shape* is
 * not: "it 009 058 11006" is stored as "00905811006", "mi" as "MI".
 */

export interface IssuerInput {
  legalName?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  taxRegime?: string | null;
  street?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  reaOffice?: string | null;
  reaNumber?: string | null;
  shareCapital?: string | number | null;
  soleShareholder?: string | null;
  liquidationStatus?: string | null;
  email?: string | null;
  phone?: string | null;
  iban?: string | null;
  bankName?: string | null;
  rechargeStampDuty?: boolean | null;
}

const text = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};
const code = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, "").toUpperCase();
  return t ? t.slice(0, max) : null;
};
const oneOf = <T extends string>(v: string | null | undefined, allowed: readonly T[]): T | null =>
  allowed.includes((v ?? "") as T) ? (v as T) : null;

export function cleanIssuer(input: IssuerInput) {
  const capital =
    input.shareCapital === "" || input.shareCapital == null
      ? null
      : Number(String(input.shareCapital).replace(",", "."));
  return {
    legalName: text(input.legalName, 80),
    vatNumber: normaliseVat(input.vatNumber) || null,
    fiscalCode: code(input.fiscalCode, 16),
    taxRegime: code(input.taxRegime, 4),
    street: text(input.street, 60),
    zipCode: code(input.zipCode, 10),
    city: text(input.city, 60),
    province: code(input.province, 2),
    country: text(input.country, 60),
    reaOffice: code(input.reaOffice, 2),
    reaNumber: text(input.reaNumber, 20),
    shareCapital: capital != null && Number.isFinite(capital) && capital >= 0 ? capital.toFixed(2) : null,
    soleShareholder: oneOf(input.soleShareholder, ["SU", "SM"] as const),
    liquidationStatus: oneOf(input.liquidationStatus, ["LS", "LN"] as const),
    email: text(input.email, 256),
    phone: text(input.phone, 12),
    iban: code(input.iban, 34),
    bankName: text(input.bankName, 80),
    rechargeStampDuty: Boolean(input.rechargeStampDuty),
  };
}

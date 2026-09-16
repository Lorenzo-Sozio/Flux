import { normaliseVat } from "@/lib/fiscal-ids";
import { NATURE_CODES } from "@/lib/invoice-rules";
import { STAMP_DUTY_AMOUNT } from "@/lib/stamp-duty";
import { countryCode } from "@/lib/territory";

import { type InvoiceLine, invoiceTotals } from "./totals";

/**
 * A FatturaPA 1.2.3 document (FPR12, between private parties), built from what an
 * issued invoice froze: the issuer, the customer and the lines.
 *
 * ⚠️⚠️ Validity is checked against the official XSD in the test suite
 * (src/lib/fatturapa/schema/, downloaded from fatturapa.gov.it) — not against a
 * reading of the specification. What the schema cannot check, the arithmetic SDI
 * performs, is `invoiceTotals`' job and tested there.
 *
 * ⚠️ Element order is significant in XSD sequences; every block below follows the
 * schema's order, and a reordering is a rejected file.
 */

const NS = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2";

export interface XmlParty {
  name?: string | null;
  legalName?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  street?: string | null;
  zipCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  taxRegime?: string | null;
  reaOffice?: string | null;
  reaNumber?: string | null;
  shareCapital?: string | number | null;
  soleShareholder?: string | null;
  liquidationStatus?: string | null;
  email?: string | null;
  phone?: string | null;
  iban?: string | null;
  sdiCode?: string | null;
  pec?: string | null;
}

export interface XmlInvoice {
  documentType: "TD01" | "TD04";
  documentNumber: string;
  issueDate: string;
  currency: string;
  discountPercent: number;
  stampDuty: boolean;
  paymentMethod: string;
  dueDate?: string | null;
  notes?: string | null;
  issuer: XmlParty;
  customer: XmlParty;
  lines: InvoiceLine[];
  /** ProgressivoInvio: up to 10 characters, unique per transmitter. */
  transmissionId: string;
  /** The subject transmitting to SDI; the issuer itself unless an intermediary is used. */
  transmitter?: { country: string; code: string };
  /** For a credit note, the invoice it corrects. */
  originalInvoice?: { documentNumber: string; issueDate: string } | null;
}

// ─── Values ───────────────────────────────────────────────────────────────────

/**
 * Text the schema accepts: Basic Latin and Latin-1 Supplement only.
 *
 * ⚠️ "€", typographic quotes, dashes and emoji are all outside it, and a single one
 * in a description rejects the whole file. They are replaced with their plain
 * equivalents; accented Italian letters are inside the range and kept.
 */
export function latin(value: string | null | undefined, max: number): string {
  const replaced = (value ?? "")
    .replace(/€/g, "EUR")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\r\n\t]+/g, " ");
  let out = "";
  for (const ch of replaced) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0xff) out += ch;
    else {
      const stripped = ch.normalize("NFD").replace(/\p{M}/gu, "");
      const c = stripped.codePointAt(0) ?? 0;
      if (stripped.length === 1 && c >= 0x20 && c <= 0xff) out += stripped;
    }
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Two decimals, or up to eight when the value needs them (Amount8DecimalType). */
function amount8(n: number): string {
  const fixed = n.toFixed(8).replace(/0+$/, "");
  const decimals = Math.max(2, fixed.split(".")[1]?.length ?? 0);
  return n.toFixed(decimals);
}

const amount2 = (n: number) => n.toFixed(2);

const el = (name: string, value: string | null | undefined): string =>
  value == null || value === "" ? "" : `<${name}>${escapeXml(value)}</${name}>`;

const block = (name: string, inner: string): string => (inner ? `<${name}>${inner}</${name}>` : "");

// ─── Parties ──────────────────────────────────────────────────────────────────

function sede(p: XmlParty): string {
  const nation = countryCode(p.country) ?? "IT";
  const italian = nation === "IT";
  return block(
    "Sede",
    el("Indirizzo", latin(p.street, 60)) +
      // A foreign address has no Italian CAP; the schema still wants five digits.
      el("CAP", italian ? (p.zipCode ?? "").trim() : "00000") +
      el("Comune", latin(p.city, 60)) +
      (italian ? el("Provincia", (p.province ?? "").trim().toUpperCase()) : "") +
      el("Nazione", nation),
  );
}

function cedente(p: XmlParty): string {
  const rea =
    p.reaOffice && p.reaNumber
      ? block(
          "IscrizioneREA",
          el("Ufficio", p.reaOffice) +
            el("NumeroREA", latin(p.reaNumber, 20)) +
            (p.shareCapital != null && p.shareCapital !== ""
              ? el("CapitaleSociale", amount2(Number(p.shareCapital)))
              : "") +
            el("SocioUnico", p.soleShareholder) +
            el("StatoLiquidazione", p.liquidationStatus ?? "LN"),
        )
      : "";
  const contacts = block("Contatti", el("Telefono", latin(p.phone, 12)) + el("Email", p.email ?? ""));
  return block(
    "CedentePrestatore",
    block(
      "DatiAnagrafici",
      block("IdFiscaleIVA", el("IdPaese", "IT") + el("IdCodice", normaliseVat(p.vatNumber))) +
        el("CodiceFiscale", p.fiscalCode ?? "") +
        block("Anagrafica", el("Denominazione", latin(p.legalName, 80))) +
        el("RegimeFiscale", p.taxRegime ?? "RF01"),
    ) +
      sede(p) +
      rea +
      contacts,
  );
}

function cessionario(p: XmlParty): string {
  const nation = countryCode(p.country) ?? "IT";
  const vat = p.vatNumber ? normaliseVat(p.vatNumber).replace(new RegExp(`^${nation}`), "") : "";
  const idFiscale =
    nation === "IT"
      ? vat
        ? block("IdFiscaleIVA", el("IdPaese", "IT") + el("IdCodice", vat))
        : ""
      : // A foreign customer is identified by its own VAT number, or the conventional placeholder.
        block("IdFiscaleIVA", el("IdPaese", nation) + el("IdCodice", vat || "99999999999"));
  return block(
    "CessionarioCommittente",
    block(
      "DatiAnagrafici",
      idFiscale +
        (nation === "IT" ? el("CodiceFiscale", p.fiscalCode ?? "") : "") +
        block("Anagrafica", el("Denominazione", latin(p.name, 80))),
    ) + sede(p),
  );
}

/** Where SDI delivers: the codice destinatario, the PEC with 0000000, or XXXXXXX abroad. */
export function delivery(customer: XmlParty): { code: string; pec: string | null } {
  if ((countryCode(customer.country) ?? "IT") !== "IT") return { code: "XXXXXXX", pec: null };
  const sdi = (customer.sdiCode ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{7}$/.test(sdi) && sdi !== "0000000") return { code: sdi, pec: null };
  const pec = customer.pec?.trim() || null;
  return { code: "0000000", pec };
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function buildFatturaPaXml(inv: XmlInvoice): string {
  const totals = invoiceTotals(inv.lines, inv.discountPercent);
  const transmitter = inv.transmitter ?? {
    country: "IT",
    code: (inv.issuer.fiscalCode || normaliseVat(inv.issuer.vatNumber)).toUpperCase(),
  };
  const destination = delivery(inv.customer);

  const header = block(
    "FatturaElettronicaHeader",
    block(
      "DatiTrasmissione",
      block("IdTrasmittente", el("IdPaese", transmitter.country) + el("IdCodice", transmitter.code)) +
        el("ProgressivoInvio", inv.transmissionId.slice(0, 10)) +
        el("FormatoTrasmissione", "FPR12") +
        el("CodiceDestinatario", destination.code) +
        el("PECDestinatario", destination.pec),
    ) +
      cedente(inv.issuer) +
      cessionario(inv.customer),
  );

  const causali = (inv.notes ? latin(inv.notes, 2000).match(/.{1,200}/g) : null) ?? [];
  const datiGeneraliDocumento = block(
    "DatiGeneraliDocumento",
    el("TipoDocumento", inv.documentType) +
      el("Divisa", inv.currency) +
      el("Data", inv.issueDate) +
      el("Numero", latin(inv.documentNumber, 20)) +
      (inv.stampDuty
        ? block("DatiBollo", el("BolloVirtuale", "SI") + el("ImportoBollo", amount2(STAMP_DUTY_AMOUNT)))
        : "") +
      el("ImportoTotaleDocumento", amount2(totals.total)) +
      causali.map((c) => el("Causale", c)).join(""),
  );
  const collegate = inv.originalInvoice
    ? block(
        "DatiFattureCollegate",
        el("IdDocumento", latin(inv.originalInvoice.documentNumber, 20)) + el("Data", inv.originalInvoice.issueDate),
      )
    : "";

  const lines = totals.details
    .map((d, i) =>
      block(
        "DettaglioLinee",
        el("NumeroLinea", String(i + 1)) +
          el("Descrizione", latin(d.description, 1000) || "-") +
          (d.quantity != null ? el("Quantita", amount8(d.quantity)) : "") +
          el("PrezzoUnitario", amount8(d.unitPrice)) +
          (d.discountPercent > 0
            ? block("ScontoMaggiorazione", el("Tipo", "SC") + el("Percentuale", amount2(d.discountPercent)))
            : "") +
          el("PrezzoTotale", amount2(d.total)) +
          el("AliquotaIVA", amount2(d.rate)) +
          el("Natura", d.nature),
      ),
    )
    .join("");

  const summary = totals.summary
    .map((r) =>
      block(
        "DatiRiepilogo",
        el("AliquotaIVA", amount2(r.rate)) +
          el("Natura", r.nature) +
          el("ImponibileImporto", amount2(r.taxable)) +
          el("Imposta", amount2(r.tax)) +
          (r.rate > 0 ? el("EsigibilitaIVA", "I") : "") +
          (r.nature ? el("RiferimentoNormativo", latin(NATURE_CODES[r.nature], 100)) : ""),
      ),
    )
    .join("");

  const iban = (inv.issuer.iban ?? "").replace(/\s+/g, "").toUpperCase();
  const payment =
    totals.total > 0
      ? block(
          "DatiPagamento",
          el("CondizioniPagamento", "TP02") +
            block(
              "DettaglioPagamento",
              el("ModalitaPagamento", inv.paymentMethod) +
                el("DataScadenzaPagamento", inv.dueDate ?? "") +
                el("ImportoPagamento", amount2(totals.total)) +
                (inv.paymentMethod === "MP05" && iban ? el("IBAN", iban) : ""),
            ),
        )
      : "";

  const body = block(
    "FatturaElettronicaBody",
    block("DatiGenerali", datiGeneraliDocumento + collegate) + block("DatiBeniServizi", lines + summary) + payment,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<p:FatturaElettronica versione="FPR12" xmlns:p="${NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${header}${body}</p:FatturaElettronica>\n`;
}

/** SDI's file name: IT, the transmitter's code, an underscore, the progressive. */
export function fatturaPaFileName(inv: Pick<XmlInvoice, "issuer" | "transmitter" | "transmissionId">): string {
  const code = inv.transmitter?.code ?? (inv.issuer.fiscalCode || normaliseVat(inv.issuer.vatNumber));
  return `IT${code.toUpperCase()}_${inv.transmissionId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 5)
    .padStart(5, "0")}.xml`;
}

/**
 * A ProgressivoInvio for an invoice: base 36 of year and number, so it is unique for
 * the issuer, stable across retries of the same invoice, and five characters long.
 */
export function transmissionIdFor(fiscalYear: number, number: number, series: string): string {
  const seriesPart = series
    ? series
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase()
        .slice(0, 2)
    : "";
  return `${seriesPart}${((fiscalYear % 100) * 100000 + number).toString(36).toUpperCase()}`.slice(-10);
}

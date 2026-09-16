import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  DOCUMENT_LOCALE,
  type DocumentLanguage,
  fill,
  formatDocumentMoney,
  INVOICE_TEXT,
  PAYMENT_METHOD_TEXT,
} from "@/lib/document-language";
import type { InvoiceTotals } from "@/lib/fatturapa/totals";
import type { XmlParty } from "@/lib/fatturapa/xml";
import { TAX_REGIMES } from "@/lib/fiscal-ids";
import { NATURE_CODES } from "@/lib/invoice-rules";

/**
 * The courtesy copy of an issued invoice: what a customer can read, print and file.
 *
 * ⚠️ It is not the invoice. In Italy the invoice is the XML that goes through SDI,
 * and a PDF presented as the invoice is a document the customer cannot record. The
 * footer says so on every page, in the wording customers' accountants expect.
 *
 * ⚠️ Everything on it comes from what the invoice froze when it was issued — the
 * issuer, the customer, the lines — so the copy printed next year matches the XML
 * sent today, whatever has happened to the company record since.
 */

export interface InvoicePdfData {
  documentType: "TD01" | "TD04";
  documentNumber: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  paymentMethod: string;
  notes: string | null;
  stampDuty: boolean;
  issuer: XmlParty & { bankName?: string | null };
  customer: XmlParty;
  totals: InvoiceTotals;
  originalInvoice?: { documentNumber: string; issueDate: string } | null;
  discountPercent: number;
  /** The customer's language, frozen in the snapshot when the invoice was issued. */
  lang: DocumentLanguage;
}

/** The legal notices, in Italian: what an Italian customer's copy says, and what tests check. */
export const COURTESY_NOTICE = INVOICE_TEXT.it.courtesyNotice;
export const STAMP_NOTICE = INVOICE_TEXT.it.stampNotice;

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: INK, paddingTop: 44, paddingBottom: 72, paddingHorizontal: 44 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24, gap: 24 },
  issuerName: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  line: { marginBottom: 1.5, color: "#374151" },
  docBox: { alignItems: "flex-end" },
  docType: { fontSize: 8, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
  docNumber: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 2 },
  docDate: { marginTop: 4, color: "#374151" },
  parties: { flexDirection: "row", gap: 24, marginBottom: 20 },
  party: { flex: 1, borderWidth: 1, borderColor: RULE, borderRadius: 4, padding: 10 },
  label: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  thead: { flexDirection: "row", borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 4 },
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: RULE, paddingVertical: 5 },
  cDesc: { flex: 4, paddingRight: 6 },
  cQty: { flex: 0.9, textAlign: "right" },
  cPrice: { flex: 1.3, textAlign: "right" },
  cDisc: { flex: 0.8, textAlign: "right" },
  cVat: { flex: 0.9, textAlign: "right" },
  cTotal: { flex: 1.4, textAlign: "right" },
  lower: { flexDirection: "row", gap: 24, marginTop: 16 },
  lowerLeft: { flex: 1.3 },
  lowerRight: { flex: 1 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.2,
    borderTopColor: INK,
    marginTop: 4,
    paddingTop: 6,
  },
  totalText: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  block: { marginBottom: 10 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 44,
    right: 44,
    borderTopWidth: 0.6,
    borderTopColor: RULE,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  footerText: { fontSize: 7, color: MUTED, flex: 1, lineHeight: 1.4 },
  pageNo: { fontSize: 7, color: MUTED },
});

/** dd/mm/yyyy in Italian, dd/mm/yyyy in British English too: the form an invoice date takes. */
const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function address(p: XmlParty): string[] {
  const cityLine = [p.zipCode, p.city, p.province ? `(${p.province})` : null].filter(Boolean).join(" ");
  return [p.street, cityLine, p.country && p.country !== "IT" ? p.country : null].filter(Boolean) as string[];
}

function ids(p: XmlParty, lang: DocumentLanguage): string[] {
  const tx = INVOICE_TEXT[lang];
  const out: string[] = [];
  if (p.vatNumber) out.push(`${tx.vat} ${p.vatNumber}`);
  if (p.fiscalCode && p.fiscalCode !== p.vatNumber) out.push(`${tx.fiscalCode} ${p.fiscalCode}`);
  return out;
}

export function InvoicePDF({ data }: { data: InvoicePdfData }) {
  const { lang } = data;
  const tx = INVOICE_TEXT[lang];
  const money = (n: number) => formatDocumentMoney(n, data.currency, lang);
  const qty = (n: number | null) =>
    n === null
      ? ""
      : new Intl.NumberFormat(DOCUMENT_LOCALE[lang], { maximumFractionDigits: 3, useGrouping: "always" }).format(n);
  const pct = (n: number) => `${qty(n)}%`;
  const { issuer, customer, totals } = data;
  const title = data.documentType === "TD04" ? tx.creditNote : tx.invoice;
  const regime = issuer.taxRegime ? `${issuer.taxRegime} · ${TAX_REGIMES[issuer.taxRegime] ?? ""}` : null;
  const rea = issuer.reaOffice && issuer.reaNumber ? `REA ${issuer.reaOffice}-${issuer.reaNumber}` : null;
  const natures = [...new Set(totals.summary.map((r) => r.nature).filter(Boolean))] as string[];

  return (
    <Document title={`${title} ${data.documentNumber}`} author={issuer.legalName ?? issuer.name ?? undefined}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.issuerName}>{issuer.legalName ?? issuer.name ?? ""}</Text>
            {address(issuer).map((l) => (
              <Text key={l} style={s.line}>
                {l}
              </Text>
            ))}
            {ids(issuer, lang).length > 0 && <Text style={s.line}>{ids(issuer, lang).join(" · ")}</Text>}
            {rea && <Text style={s.line}>{rea}</Text>}
            {(issuer.email || issuer.phone) && (
              <Text style={s.line}>{[issuer.email, issuer.phone].filter(Boolean).join(" · ")}</Text>
            )}
          </View>
          <View style={s.docBox}>
            <Text style={s.docType}>{title}</Text>
            <Text style={s.docNumber}>
              {tx.number} {data.documentNumber}
            </Text>
            <Text style={s.docDate}>
              {tx.dated} {day(data.issueDate)}
            </Text>
            {data.originalInvoice && (
              <Text style={s.docDate}>
                {fill(tx.creditNoteReference, {
                  number: data.originalInvoice.documentNumber,
                  date: day(data.originalInvoice.issueDate),
                })}
              </Text>
            )}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.label}>{tx.customer}</Text>
            <Text style={[s.line, s.bold]}>{customer.name ?? customer.legalName ?? ""}</Text>
            {address(customer).map((l) => (
              <Text key={l} style={s.line}>
                {l}
              </Text>
            ))}
            {ids(customer, lang).length > 0 && <Text style={s.line}>{ids(customer, lang).join(" · ")}</Text>}
          </View>
          <View style={s.party}>
            <Text style={s.label}>{tx.sdiDelivery}</Text>
            {customer.sdiCode && customer.sdiCode !== "0000000" ? (
              <Text style={s.line}>
                {tx.recipientCode} {customer.sdiCode}
              </Text>
            ) : customer.pec ? (
              <Text style={s.line}>
                {tx.pec} {customer.pec}
              </Text>
            ) : (
              <Text style={s.line}>—</Text>
            )}
            {regime && (
              <>
                <Text style={[s.label, { marginTop: 8 }]}>{tx.issuerRegime}</Text>
                <Text style={s.line}>{regime}</Text>
              </>
            )}
          </View>
        </View>

        <View style={s.thead} fixed>
          <Text style={[s.th, s.cDesc]}>{tx.description}</Text>
          <Text style={[s.th, s.cQty]}>{tx.quantity}</Text>
          <Text style={[s.th, s.cPrice]}>{tx.price}</Text>
          <Text style={[s.th, s.cDisc]}>{tx.discount}</Text>
          <Text style={[s.th, s.cVat]}>{tx.rate}</Text>
          <Text style={[s.th, s.cTotal]}>{tx.amount}</Text>
        </View>
        {totals.details.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are an ordered, frozen list
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cDesc}>
              {d.isDocumentDiscount ? fill(tx.documentDiscount, { percent: pct(data.discountPercent) }) : d.description}
            </Text>
            <Text style={s.cQty}>{qty(d.quantity)}</Text>
            <Text style={s.cPrice}>{d.isDocumentDiscount ? "" : money(d.unitPrice)}</Text>
            <Text style={s.cDisc}>{d.discountPercent ? qty(d.discountPercent) : ""}</Text>
            <Text style={s.cVat}>{d.nature ?? pct(d.rate)}</Text>
            <Text style={s.cTotal}>{money(d.total)}</Text>
          </View>
        ))}

        <View style={s.lower} wrap={false}>
          <View style={s.lowerLeft}>
            <View style={s.block}>
              <Text style={s.label}>{tx.payment}</Text>
              <Text style={s.line}>{PAYMENT_METHOD_TEXT[lang][data.paymentMethod] ?? data.paymentMethod}</Text>
              {data.dueDate && (
                <Text style={s.line}>
                  {tx.due} {day(data.dueDate)}
                </Text>
              )}
              {issuer.iban && (
                <Text style={s.line}>
                  IBAN {issuer.iban}
                  {issuer.bankName ? ` · ${issuer.bankName}` : ""}
                </Text>
              )}
            </View>
            {natures.length > 0 && (
              <View style={s.block}>
                <Text style={s.label}>{tx.exemptOperations}</Text>
                {natures.map((n) => (
                  <Text key={n} style={s.line}>
                    {n} · {NATURE_CODES[n] ?? ""}
                  </Text>
                ))}
              </View>
            )}
            {data.stampDuty && (
              <View style={s.block}>
                <Text style={s.line}>{tx.stampNotice}</Text>
              </View>
            )}
            {data.notes && (
              <View style={s.block}>
                <Text style={s.label}>{tx.notes}</Text>
                <Text style={s.line}>{data.notes}</Text>
              </View>
            )}
          </View>
          <View style={s.lowerRight}>
            <View style={s.sumRow}>
              <Text>{tx.taxable}</Text>
              <Text>{money(totals.taxableAmount)}</Text>
            </View>
            {totals.summary.map((r) => (
              <View key={`${r.rate}-${r.nature ?? ""}`} style={s.sumRow}>
                <Text style={{ color: MUTED }}>
                  {r.nature
                    ? fill(tx.natureOn, { nature: r.nature, taxable: money(r.taxable) })
                    : fill(tx.vatOn, { rate: pct(r.rate), taxable: money(r.taxable) })}
                </Text>
                <Text>{money(r.tax)}</Text>
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={s.totalText}>{tx.documentTotal}</Text>
              <Text style={s.totalText}>{money(totals.total)}</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{tx.courtesyNotice}</Text>
          <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

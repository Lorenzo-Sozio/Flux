import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoiceTotals } from "@/lib/fatturapa/totals";
import type { XmlParty } from "@/lib/fatturapa/xml";
import { TAX_REGIMES } from "@/lib/fiscal-ids";
import { PAYMENT_METHODS } from "@/lib/invoice-draft";
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
}

export const COURTESY_NOTICE =
  "Copia di cortesia priva di valore fiscale ai sensi dell'art. 21 del D.P.R. 633/1972. " +
  "La fattura elettronica originale è quella trasmessa tramite il Sistema di Interscambio (SDI) " +
  "ed è disponibile nell'area riservata del sito dell'Agenzia delle Entrate.";

export const STAMP_NOTICE = "Imposta di bollo assolta in modo virtuale ai sensi dell'art. 6 del D.M. 17 giugno 2014.";

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

const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function address(p: XmlParty): string[] {
  const cityLine = [p.zipCode, p.city, p.province ? `(${p.province})` : null].filter(Boolean).join(" ");
  return [p.street, cityLine, p.country && p.country !== "IT" ? p.country : null].filter(Boolean) as string[];
}

function ids(p: XmlParty): string[] {
  const out: string[] = [];
  if (p.vatNumber) out.push(`P.IVA ${p.vatNumber}`);
  if (p.fiscalCode && p.fiscalCode !== p.vatNumber) out.push(`C.F. ${p.fiscalCode}`);
  return out;
}

export function InvoicePDF({ data }: { data: InvoicePdfData }) {
  const money = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: data.currency, useGrouping: "always" }).format(n);
  const qty = (n: number | null) =>
    n === null ? "" : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3, useGrouping: "always" }).format(n);
  const { issuer, customer, totals } = data;
  const title = data.documentType === "TD04" ? "Nota di credito" : "Fattura";
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
            {ids(issuer).length > 0 && <Text style={s.line}>{ids(issuer).join(" · ")}</Text>}
            {rea && <Text style={s.line}>{rea}</Text>}
            {(issuer.email || issuer.phone) && (
              <Text style={s.line}>{[issuer.email, issuer.phone].filter(Boolean).join(" · ")}</Text>
            )}
          </View>
          <View style={s.docBox}>
            <Text style={s.docType}>{title}</Text>
            <Text style={s.docNumber}>n. {data.documentNumber}</Text>
            <Text style={s.docDate}>del {day(data.issueDate)}</Text>
            {data.originalInvoice && (
              <Text style={s.docDate}>
                rif. fattura n. {data.originalInvoice.documentNumber} del {day(data.originalInvoice.issueDate)}
              </Text>
            )}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.label}>Cliente</Text>
            <Text style={[s.line, s.bold]}>{customer.name ?? customer.legalName ?? ""}</Text>
            {address(customer).map((l) => (
              <Text key={l} style={s.line}>
                {l}
              </Text>
            ))}
            {ids(customer).length > 0 && <Text style={s.line}>{ids(customer).join(" · ")}</Text>}
          </View>
          <View style={s.party}>
            <Text style={s.label}>Recapito SDI</Text>
            {customer.sdiCode && customer.sdiCode !== "0000000" ? (
              <Text style={s.line}>Codice destinatario {customer.sdiCode}</Text>
            ) : customer.pec ? (
              <Text style={s.line}>PEC {customer.pec}</Text>
            ) : (
              <Text style={s.line}>—</Text>
            )}
            {regime && (
              <>
                <Text style={[s.label, { marginTop: 8 }]}>Regime fiscale emittente</Text>
                <Text style={s.line}>{regime}</Text>
              </>
            )}
          </View>
        </View>

        <View style={s.thead} fixed>
          <Text style={[s.th, s.cDesc]}>Descrizione</Text>
          <Text style={[s.th, s.cQty]}>Q.tà</Text>
          <Text style={[s.th, s.cPrice]}>Prezzo</Text>
          <Text style={[s.th, s.cDisc]}>Sc. %</Text>
          <Text style={[s.th, s.cVat]}>IVA</Text>
          <Text style={[s.th, s.cTotal]}>Importo</Text>
        </View>
        {totals.details.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are an ordered, frozen list
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cDesc}>{d.description}</Text>
            <Text style={s.cQty}>{qty(d.quantity)}</Text>
            <Text style={s.cPrice}>{d.isDocumentDiscount ? "" : money(d.unitPrice)}</Text>
            <Text style={s.cDisc}>{d.discountPercent ? qty(d.discountPercent) : ""}</Text>
            <Text style={s.cVat}>{d.nature ?? `${qty(d.rate)}%`}</Text>
            <Text style={s.cTotal}>{money(d.total)}</Text>
          </View>
        ))}

        <View style={s.lower} wrap={false}>
          <View style={s.lowerLeft}>
            <View style={s.block}>
              <Text style={s.label}>Pagamento</Text>
              <Text style={s.line}>{PAYMENT_METHODS[data.paymentMethod] ?? data.paymentMethod}</Text>
              {data.dueDate && <Text style={s.line}>Scadenza {day(data.dueDate)}</Text>}
              {issuer.iban && (
                <Text style={s.line}>
                  IBAN {issuer.iban}
                  {issuer.bankName ? ` · ${issuer.bankName}` : ""}
                </Text>
              )}
            </View>
            {natures.length > 0 && (
              <View style={s.block}>
                <Text style={s.label}>Operazioni senza IVA</Text>
                {natures.map((n) => (
                  <Text key={n} style={s.line}>
                    {n} · {NATURE_CODES[n] ?? ""}
                  </Text>
                ))}
              </View>
            )}
            {data.stampDuty && (
              <View style={s.block}>
                <Text style={s.line}>{STAMP_NOTICE}</Text>
              </View>
            )}
            {data.notes && (
              <View style={s.block}>
                <Text style={s.label}>Note</Text>
                <Text style={s.line}>{data.notes}</Text>
              </View>
            )}
          </View>
          <View style={s.lowerRight}>
            <View style={s.sumRow}>
              <Text>Imponibile</Text>
              <Text>{money(totals.taxableAmount)}</Text>
            </View>
            {totals.summary.map((r) => (
              <View key={`${r.rate}-${r.nature ?? ""}`} style={s.sumRow}>
                <Text style={{ color: MUTED }}>
                  {r.nature ? `${r.nature} su ${money(r.taxable)}` : `IVA ${qty(r.rate)}% su ${money(r.taxable)}`}
                </Text>
                <Text>{money(r.tax)}</Text>
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={s.totalText}>Totale documento</Text>
              <Text style={s.totalText}>{money(totals.total)}</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{COURTESY_NOTICE}</Text>
          <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

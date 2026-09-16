import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { getQuoteById } from "@/actions/quotes";
import {
  DOCUMENT_LOCALE,
  type DocumentLanguage,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  QUOTE_TEXT,
  quoteStatusText,
} from "@/lib/document-language";
import type { SellerIdentity } from "@/lib/seller-identity";

type Quote = Awaited<ReturnType<typeof getQuoteById>>;

const BRAND_COLOR = "#111827";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const ACCENT = "#2563eb";

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: BRAND_COLOR,
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    backgroundColor: "#ffffff",
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 32 },
  brandName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BRAND_COLOR },
  brandSub: { fontSize: 9, color: MUTED, marginTop: 2 },
  quoteNum: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
  badge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-end",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ── Two-column info block ────────────────────────────────────────────────────
  infoRow: { flexDirection: "row", gap: 32, marginBottom: 28 },
  infoBlock: { flex: 1 },
  infoBlockRight: { flex: 1, alignItems: "flex-end" },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: MUTED,
    marginBottom: 5,
  },
  infoLine: { fontSize: 10, color: BRAND_COLOR, marginBottom: 2 },
  infoLineBold: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BRAND_COLOR, marginBottom: 2 },

  // ── Divider ─────────────────────────────────────────────────────────────────
  divider: { borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 20 },

  // ── Table ───────────────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: BRAND_COLOR,
    paddingBottom: 5,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 6,
  },
  tableRowAlt: { backgroundColor: "#f9fafb" },
  colDesc: { flex: 3, paddingRight: 8 },
  colNum: { flex: 1, textAlign: "right", paddingRight: 4 },
  colNum2: { flex: 1.2, textAlign: "right", paddingRight: 4 },
  thText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  tdDesc: { fontSize: 10 },
  tdDescSub: { fontSize: 8, color: MUTED, marginTop: 1 },
  tdNum: { fontSize: 10 },
  tdBold: { fontFamily: "Helvetica-Bold" },

  // ── Totals ──────────────────────────────────────────────────────────────────
  totalsContainer: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  totalsInner: { width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { fontSize: 10, color: MUTED },
  totalsValue: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right" },
  totalsFinalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.5,
    borderTopColor: BRAND_COLOR,
    marginTop: 4,
    paddingTop: 8,
  },
  totalsFinalLabel: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  totalsFinalValue: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right" },

  // ── Notes ───────────────────────────────────────────────────────────────────
  notesSection: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: BORDER },
  notesText: { fontSize: 10, color: "#374151", lineHeight: 1.5 },

  // ── Footer ──────────────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 8, color: MUTED },
});

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  draft: { bg: "#f1f5f9", color: "#475569" },
  sent: { bg: "#eff6ff", color: "#1d4ed8" },
  viewed: { bg: "#f5f3ff", color: "#6d28d9" },
  accepted: { bg: "#f0fdf4", color: "#15803d" },
  declined: { bg: "#fef2f2", color: "#dc2626" },
  expired: { bg: "#fffbeb", color: "#d97706" },
  converted: { bg: "#f0fdfa", color: "#0f766e" },
};

interface Props {
  quote: Quote;
  seller: SellerIdentity;
  /** The customer's language: see src/lib/document-language.ts. */
  lang: DocumentLanguage;
}

/**
 * The quote as the customer receives it.
 *
 * ⚠️ It was written entirely in English, whoever the customer, with amounts as
 * "EUR 1,234.56" in the server's own locale and "Flux CRM" as the seller. The
 * texts, the numbers and the dates now follow the customer's language, and the
 * seller is the company making the offer.
 */
export function QuotePDF({ quote, seller, lang }: Props) {
  const tx = QUOTE_TEXT[lang];
  const money = (v: string | number | null | undefined) => formatDocumentMoney(v, quote.currency, lang);
  const date = (v: Date | string | null | undefined) => formatDocumentDate(v, lang);
  const pct = (v: string | number | null | undefined) => formatDocumentPercent(v, lang);

  const badge = BADGE_COLORS[quote.status] ?? BADGE_COLORS.draft;
  const contactName = quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim() : null;

  const discountAmt = parseFloat(quote.discountAmount ?? "0");
  const taxAmt = parseFloat(quote.taxAmount ?? "0");
  const company = quote.company;
  const cityLine = company ? [company.zipCode, company.city, company.state].filter(Boolean).join(" ") : "";

  return (
    <Document
      title={`${tx.documentTitle} ${quote.quoteNumber}`}
      author={seller.name}
      subject={tx.subtitle}
      language={lang}
    >
      <Page size="A4" style={s.page}>
        {/* ── Header ── */}
        <View style={s.header}>
          <View style={{ maxWidth: 300 }}>
            <Text style={s.brandName}>{seller.name}</Text>
            {seller.address && <Text style={s.brandSub}>{seller.address}</Text>}
            {seller.vatNumber && (
              <Text style={s.brandSub}>
                {tx.vat} {seller.vatNumber}
              </Text>
            )}
            {(seller.email || seller.phone) && (
              <Text style={s.brandSub}>{[seller.email, seller.phone].filter(Boolean).join(" · ")}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.brandSub}>{tx.documentTitle.toUpperCase()}</Text>
            <Text style={s.quoteNum}>{quote.quoteNumber}</Text>
            <View style={[s.badge, { backgroundColor: badge.bg }]}>
              <Text style={{ color: badge.color }}>{quoteStatusText(quote.status, lang)}</Text>
            </View>
          </View>
        </View>

        {/* ── Customer / details ── */}
        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.sectionLabel}>{tx.billTo}</Text>
            {company && <Text style={s.infoLineBold}>{company.name}</Text>}
            {contactName && (
              <Text style={s.infoLine}>
                {tx.contactPerson}: {contactName}
              </Text>
            )}
            {company?.street && <Text style={s.infoLine}>{company.street}</Text>}
            {cityLine && <Text style={s.infoLine}>{cityLine}</Text>}
            {company?.country && <Text style={s.infoLine}>{company.country}</Text>}
            {company?.vatNumber && (
              <Text style={[s.infoLine, { marginTop: 4, color: MUTED }]}>
                {tx.vat} {company.vatNumber}
              </Text>
            )}
          </View>

          <View style={s.infoBlockRight}>
            <Text style={s.sectionLabel}>{tx.details}</Text>
            <Text style={s.infoLine}>
              <Text style={{ color: MUTED }}>{tx.issued} </Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{date(quote.issuedAt)}</Text>
            </Text>
            {quote.expiresAt && (
              <Text style={s.infoLine}>
                <Text style={{ color: MUTED }}>{tx.expires} </Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{date(quote.expiresAt)}</Text>
              </Text>
            )}
            {quote.owner?.name && (
              <Text style={s.infoLine}>
                <Text style={{ color: MUTED }}>{tx.reference}: </Text>
                {quote.owner.name}
              </Text>
            )}
          </View>
        </View>

        <View style={s.divider} />

        {/* ── Lines ── */}
        <View style={s.tableHeader} fixed>
          <View style={s.colDesc}>
            <Text style={s.thText}>{tx.description}</Text>
          </View>
          <View style={s.colNum}>
            <Text style={[s.thText, { textAlign: "right" }]}>{tx.quantity}</Text>
          </View>
          <View style={s.colNum2}>
            <Text style={[s.thText, { textAlign: "right" }]}>{tx.unitPrice}</Text>
          </View>
          <View style={s.colNum}>
            <Text style={[s.thText, { textAlign: "right" }]}>{tx.discount}</Text>
          </View>
          <View style={s.colNum}>
            <Text style={[s.thText, { textAlign: "right" }]}>{tx.tax}</Text>
          </View>
          <View style={s.colNum2}>
            <Text style={[s.thText, { textAlign: "right" }]}>{tx.lineTotal}</Text>
          </View>
        </View>

        {quote.items.map((item, i) => (
          <View key={item.id} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]} wrap={false}>
            <View style={s.colDesc}>
              <Text style={s.tdDesc}>{item.description}</Text>
              {item.product && item.product.name !== item.description && (
                <Text style={s.tdDescSub}>{item.product.name}</Text>
              )}
            </View>
            <View style={s.colNum}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>
                {new Intl.NumberFormat(DOCUMENT_LOCALE[lang], { maximumFractionDigits: 3 }).format(item.quantity)}
              </Text>
            </View>
            <View style={s.colNum2}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>{money(item.unitPrice)}</Text>
            </View>
            <View style={s.colNum}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>
                {parseFloat(item.discountPercent ?? "0") > 0 ? pct(item.discountPercent) : "—"}
              </Text>
            </View>
            <View style={s.colNum}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>
                {parseFloat(item.taxPercent ?? "0") > 0 ? pct(item.taxPercent) : "—"}
              </Text>
            </View>
            <View style={s.colNum2}>
              <Text style={[s.tdNum, s.tdBold, { textAlign: "right" }]}>{money(item.totalPrice)}</Text>
            </View>
          </View>
        ))}

        {/* ── Totals ── */}
        <View style={s.totalsContainer} wrap={false}>
          <View style={s.totalsInner}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{tx.subtotal}</Text>
              <Text style={s.totalsValue}>{money(quote.subtotal)}</Text>
            </View>
            {discountAmt > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>
                  {tx.discountOn} ({pct(quote.discountPercent)})
                </Text>
                <Text style={[s.totalsValue, { color: "#d97706" }]}>-{money(discountAmt)}</Text>
              </View>
            )}
            {taxAmt > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>
                  {tx.taxOn}
                  {parseFloat(quote.taxPercent ?? "0") > 0 ? ` (${pct(quote.taxPercent)})` : ""}
                </Text>
                <Text style={[s.totalsValue, { color: "#475569" }]}>+{money(taxAmt)}</Text>
              </View>
            )}
            <View style={s.totalsFinalRow}>
              <Text style={s.totalsFinalLabel}>{tx.total}</Text>
              <Text style={[s.totalsFinalValue, { color: ACCENT }]}>{money(quote.totalAmount)}</Text>
            </View>
          </View>
        </View>

        {/* ── Notes ── */}
        {quote.notes && (
          <View style={s.notesSection}>
            <Text style={[s.sectionLabel, { marginBottom: 6 }]}>{tx.notes}</Text>
            <Text style={s.notesText}>{quote.notes}</Text>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {seller.name} · {quote.quoteNumber}
          </Text>
          <Text style={s.footerText}>
            {tx.generated} {date(new Date())}
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `${tx.page} ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

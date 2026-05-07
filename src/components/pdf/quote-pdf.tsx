import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { getQuoteById } from "@/actions/quotes";

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

function money(value: string | null | undefined, currency: string) {
  return `${currency} ${parseFloat(value ?? "0").toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

interface Props {
  quote: Quote;
  sellerName?: string;
  sellerEmail?: string;
}

export function QuotePDF({ quote, sellerName = "Flux CRM", sellerEmail }: Props) {
  const badge = BADGE_COLORS[quote.status] ?? BADGE_COLORS.draft;
  const contactName = quote.contact ? `${quote.contact.firstName} ${quote.contact.lastName}`.trim() : null;

  const subtotal = parseFloat(quote.subtotal ?? "0");
  const discountAmt = parseFloat(quote.discountAmount ?? "0");
  const taxAmt = parseFloat(quote.taxAmount ?? "0");
  const total = parseFloat(quote.totalAmount ?? "0");

  const today = fmtDate(new Date());

  return (
    <Document title={quote.quoteNumber} author={sellerName} subject="Quote & Proposal">
      <Page size="A4" style={s.page}>
        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.brandName}>{sellerName}</Text>
            <Text style={s.brandSub}>Quote & Proposal</Text>
            {sellerEmail && <Text style={[s.brandSub, { marginTop: 1 }]}>{sellerEmail}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.quoteNum}>{quote.quoteNumber}</Text>
            <View style={[s.badge, { backgroundColor: badge.bg }]}>
              <Text style={{ color: badge.color }}>{quote.status.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* ── Bill To / Quote Details ── */}
        <View style={s.infoRow}>
          {/* Bill To */}
          <View style={s.infoBlock}>
            <Text style={s.sectionLabel}>Bill To</Text>
            {quote.company && <Text style={s.infoLineBold}>{quote.company.name}</Text>}
            {contactName && <Text style={s.infoLine}>{contactName}</Text>}
            {quote.company?.mainEmail && <Text style={s.infoLine}>{quote.company.mainEmail}</Text>}
            {quote.company?.mainPhone && <Text style={s.infoLine}>{quote.company.mainPhone}</Text>}
            {quote.company?.street && <Text style={s.infoLine}>{quote.company.street}</Text>}
            {(quote.company?.city || quote.company?.zipCode) && (
              <Text style={s.infoLine}>{[quote.company.city, quote.company.zipCode].filter(Boolean).join(", ")}</Text>
            )}
            {quote.company?.country && <Text style={s.infoLine}>{quote.company.country}</Text>}
            {quote.company?.vatNumber && (
              <Text style={[s.infoLine, { marginTop: 4, color: MUTED }]}>VAT: {quote.company.vatNumber}</Text>
            )}
          </View>

          {/* Quote Details */}
          <View style={s.infoBlockRight}>
            <Text style={s.sectionLabel}>Details</Text>
            <Text style={s.infoLine}>
              <Text style={{ color: MUTED }}>Issued: </Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{fmtDate(quote.issuedAt)}</Text>
            </Text>
            {quote.expiresAt && (
              <Text style={s.infoLine}>
                <Text style={{ color: MUTED }}>Expires: </Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{fmtDate(quote.expiresAt)}</Text>
              </Text>
            )}
            {quote.deal && (
              <Text style={s.infoLine}>
                <Text style={{ color: MUTED }}>Deal: </Text>
                {quote.deal.name}
              </Text>
            )}
            {quote.owner?.name && (
              <Text style={s.infoLine}>
                <Text style={{ color: MUTED }}>Owner: </Text>
                {quote.owner.name}
              </Text>
            )}
          </View>
        </View>

        <View style={s.divider} />

        {/* ── Items Table ── */}
        <View style={s.tableHeader}>
          <View style={s.colDesc}>
            <Text style={s.thText}>Description</Text>
          </View>
          <View style={s.colNum}>
            <Text style={[s.thText, { textAlign: "right" }]}>Qty</Text>
          </View>
          <View style={s.colNum2}>
            <Text style={[s.thText, { textAlign: "right" }]}>Unit Price</Text>
          </View>
          <View style={s.colNum}>
            <Text style={[s.thText, { textAlign: "right" }]}>Disc.</Text>
          </View>
          <View style={s.colNum}>
            <Text style={[s.thText, { textAlign: "right" }]}>Tax</Text>
          </View>
          <View style={s.colNum2}>
            <Text style={[s.thText, { textAlign: "right" }]}>Total</Text>
          </View>
        </View>

        {quote.items.map((item, i) => (
          <View key={item.id} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
            <View style={s.colDesc}>
              <Text style={s.tdDesc}>{item.description}</Text>
              {item.product && item.product.name !== item.description && (
                <Text style={s.tdDescSub}>{item.product.name}</Text>
              )}
            </View>
            <View style={s.colNum}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>{item.quantity}</Text>
            </View>
            <View style={s.colNum2}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>{money(item.unitPrice, quote.currency)}</Text>
            </View>
            <View style={s.colNum}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>
                {parseFloat(item.discountPercent ?? "0") > 0 ? `${item.discountPercent}%` : "—"}
              </Text>
            </View>
            <View style={s.colNum}>
              <Text style={[s.tdNum, { textAlign: "right" }]}>
                {parseFloat(item.taxPercent ?? "0") > 0 ? `${item.taxPercent}%` : "—"}
              </Text>
            </View>
            <View style={s.colNum2}>
              <Text style={[s.tdNum, s.tdBold, { textAlign: "right" }]}>{money(item.totalPrice, quote.currency)}</Text>
            </View>
          </View>
        ))}

        {/* ── Totals ── */}
        <View style={s.totalsContainer}>
          <View style={s.totalsInner}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{money(String(subtotal), quote.currency)}</Text>
            </View>
            {discountAmt > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Discount ({quote.discountPercent}%)</Text>
                <Text style={[s.totalsValue, { color: "#d97706" }]}>−{money(String(discountAmt), quote.currency)}</Text>
              </View>
            )}
            {taxAmt > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Tax ({quote.taxPercent}%)</Text>
                <Text style={[s.totalsValue, { color: "#475569" }]}>+{money(String(taxAmt), quote.currency)}</Text>
              </View>
            )}
            <View style={s.totalsFinalRow}>
              <Text style={s.totalsFinalLabel}>Total</Text>
              <Text style={[s.totalsFinalValue, { color: ACCENT }]}>{money(String(total), quote.currency)}</Text>
            </View>
          </View>
        </View>

        {/* ── Notes ── */}
        {quote.notes && (
          <View style={s.notesSection}>
            <Text style={[s.sectionLabel, { marginBottom: 6 }]}>Notes</Text>
            <Text style={s.notesText}>{quote.notes}</Text>
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {sellerName} · {quote.quoteNumber}
          </Text>
          <Text style={s.footerText}>Generated {today}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

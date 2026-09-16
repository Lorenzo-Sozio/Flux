import { eq } from "drizzle-orm";

import { invoices } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import type { InvoiceLine } from "@/lib/fatturapa/totals";
import { buildFatturaPaXml, fatturaPaFileName, transmissionIdFor, type XmlParty } from "@/lib/fatturapa/xml";
import { getDb } from "@/lib/tenant-context";

/**
 * The FatturaPA file of an issued invoice.
 *
 * ⚠️ Built from the snapshots the invoice froze when it was issued — the issuer, the
 * customer and the lines as they were that day — never from the records as they are
 * now. Downloading the same invoice next year must produce the same file.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCapability("record:read");
  const { id } = await params;
  const db = await getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));

  if (!invoice) return new Response("Not found", { status: 404 });
  if (invoice.status !== "issued" || !invoice.documentNumber || !invoice.issueDate) {
    return new Response("A draft has no XML: issue it first.", { status: 409 });
  }

  const issuer = (invoice.issuerSnapshot ?? {}) as XmlParty;
  const customer = (invoice.customerSnapshot ?? {}) as XmlParty;
  const lines = (invoice.linesSnapshot ?? []) as InvoiceLine[];
  const input = {
    documentType: invoice.documentType as "TD01" | "TD04",
    documentNumber: invoice.documentNumber,
    issueDate: invoice.issueDate,
    currency: invoice.currency,
    discountPercent: Number(invoice.discountPercent),
    stampDuty: invoice.stampDuty,
    paymentMethod: invoice.paymentMethod,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    issuer,
    customer,
    lines,
    transmissionId: transmissionIdFor(invoice.fiscalYear ?? 0, invoice.number ?? 0, invoice.series),
  };

  return new Response(buildFatturaPaXml(input), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fatturaPaFileName(input)}"`,
      // An issued invoice never changes, but it is nobody else's to cache.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

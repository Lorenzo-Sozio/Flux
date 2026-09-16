import { invoiceFileResponse } from "@/lib/invoice-file-response";

/**
 * The FatturaPA file of an issued invoice.
 *
 * ⚠️ The archived file when there is one, otherwise built from the snapshots the
 * invoice froze when it was issued — the issuer, the customer and the lines as they
 * were that day — never from the records as they are now. Downloading the same
 * invoice next year must produce the same file.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return invoiceFileResponse(id, "xml");
}

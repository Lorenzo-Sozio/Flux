import { invoiceFileResponse } from "@/lib/invoice-file-response";

/** The courtesy copy of an issued invoice, as archived, or built from its snapshots. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return invoiceFileResponse(id, "pdf");
}

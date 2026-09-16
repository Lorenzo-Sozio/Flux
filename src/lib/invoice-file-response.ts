import { after } from "next/server";

import { eq } from "drizzle-orm";

import { invoices } from "@/db/schema";
import {
  EntitlementError,
  ForbiddenError,
  requireCapability,
  requirePlanModule,
  UnauthenticatedError,
} from "@/lib/auth-guard";
import { type ArchiveKind, archiveInvoice, readInvoiceFile } from "@/lib/invoice-archive";
import { getDb } from "@/lib/tenant-context";

/**
 * The response both invoice download routes send.
 *
 * A download that had to build the file also archives the invoice afterwards: the
 * archive written after issuing can have failed, and this is the next chance.
 */
export async function invoiceFileResponse(id: string, kind: ArchiveKind): Promise<Response> {
  // ⚠️ The guards throw, and a route handler that lets them go answers 500: a
  // signed-out download looked like a server fault instead of a 401.
  try {
    await requireCapability("record:read");
    await requirePlanModule("sales");
  } catch (err) {
    if (err instanceof UnauthenticatedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof ForbiddenError || err instanceof EntitlementError) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
  const db = await getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));

  if (!invoice) return new Response("Not found", { status: 404 });
  if (invoice.status !== "issued" || !invoice.documentNumber || !invoice.issueDate) {
    return new Response(`A draft has no ${kind.toUpperCase()}: issue it first.`, { status: 409 });
  }

  const file = await readInvoiceFile(db, invoice, kind);
  if (!file.archived) {
    after(() =>
      archiveInvoice(db, id).catch((err) => console.error(`[invoice-archive] invoice ${id} not archived`, err)),
    );
  }

  return new Response(file.bytes as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.name}"`,
      // An issued invoice never changes, but it is nobody else's to cache.
      "Cache-Control": "private, max-age=3600",
    },
  });
}

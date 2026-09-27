import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { deals, quotes } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { readSignedPdf } from "@/lib/quote-signature";
import { getStorage } from "@/lib/storage";
import { getDb } from "@/lib/tenant-context";

/**
 * The PDF exactly as it was signed (src/lib/quote-signature.ts), for the workspace only.
 *
 * ⚠️ Served only while its bytes still match the fingerprint stored with the signature: a
 * signed document that could have been swapped is not evidence of anything, and a download
 * that silently handed over a different file would be worse than none.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const db = await getDb();
  const [q] = await db
    .select({
      quoteNumber: quotes.quoteNumber,
      ownerId: quotes.ownerId,
      dealOwnerId: deals.ownerId,
      signedPdfKey: quotes.signedPdfKey,
      signedPdfSha256: quotes.signedPdfSha256,
    })
    .from(quotes)
    .leftJoin(deals, eq(deals.id, quotes.dealId))
    .where(eq(quotes.id, id));
  if (!q) return new NextResponse("Not found", { status: 404 });
  // Whoever may open the quote's own PDF may open the signed one: the same three as /pdf.
  const mayView = actor.userId === q.ownerId || actor.userId === q.dealOwnerId || can(actor, "quote:write");
  if (!mayView) return new NextResponse("Forbidden", { status: 403 });

  const missing = () => NextResponse.json({ error: "No signed file kept." }, { status: 404 });
  // Signed while storage was not configured: there is no file, and no store to ask.
  if (!q.signedPdfKey) return missing();
  const store = await getStorage().catch(() => null);
  if (!store) return missing();

  const file = await readSignedPdf(store, q);
  if (!file.ok) {
    return file.reason === "altered"
      ? NextResponse.json({ error: "The signed file no longer matches its fingerprint." }, { status: 409 })
      : missing();
  }
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${q.quoteNumber.replace(/[^A-Za-z0-9-]/g, "-")}-signed.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

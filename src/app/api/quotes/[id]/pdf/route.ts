import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { quotes } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { buildQuotePdf, loadQuoteForPdf } from "@/lib/quote-pdf-load";
import { getDb } from "@/lib/tenant-context";
import { resolveTenantByProbe } from "@/lib/tenant-resolve";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token");

  // ⚠️ The customer's link carries no session, so there is no tenant header and
  // `getDb()` throws: every "download PDF" from a sent quote answered 500. With a
  // token the workspace comes from the token, as on the public quote page.
  let db: Awaited<ReturnType<typeof getDb>>;
  let workspaceName: string | null = null;
  if (token !== null) {
    const resolved = await resolveTenantByProbe(`quote:${token}`, async (tenantDb) =>
      Boolean(await tenantDb.query.quotes.findFirst({ where: eq(quotes.publicToken, token), columns: { id: true } })),
    );
    if (!resolved) return new NextResponse("Not found", { status: 404 });
    db = resolved.db as typeof db;
    workspaceName = resolved.tenant.name;
  } else {
    db = await getDb();
  }

  const q = await loadQuoteForPdf(db, id);

  if (!q) return new NextResponse("Not found", { status: 404 });

  // Auth: session OR public token
  if (token !== null) {
    if (!q.publicToken || q.publicToken !== token) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } else {
    // ⚠️ This read `session.user.role`, the platform staff field, which is "user"
    // for every customer — so the exception never applied and a workspace owner
    // could not open a quote a colleague owned (audit rilievo P-01, in a corner
    // the fix did not reach). It is the capability table now, like everywhere
    // else, because a role string compared at a call site is how the two scales
    // got confused in the first place.
    const actor = await getActor();
    if (!actor) return new NextResponse("Unauthorized", { status: 401 });

    const canView = actor.userId === q.ownerId || actor.userId === q.deal?.ownerId || can(actor, "quote:write");
    if (!canView) return new NextResponse("Forbidden", { status: 403 });
  }

  // In the customer's language, whoever downloads it: this is the document they receive.
  const { bytes, fileName } = await buildQuotePdf(db, q, workspaceName);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

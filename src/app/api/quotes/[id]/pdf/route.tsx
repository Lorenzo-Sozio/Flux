import { type NextRequest, NextResponse } from "next/server";

import { renderToBuffer } from "@react-pdf/renderer";
import { desc, eq } from "drizzle-orm";

import { QuotePDF } from "@/components/pdf/quote-pdf";
import { quoteActivities, quotes } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { documentLanguage, QUOTE_TEXT } from "@/lib/document-language";
import { can } from "@/lib/permissions";
import { sellerIdentity } from "@/lib/seller-identity";
import { getDb } from "@/lib/tenant-context";
import { resolveTenantByProbe } from "@/lib/tenant-resolve";
import { USER_SUMMARY_COLUMNS } from "@/lib/user-columns";

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

  const q = await db.query.quotes.findFirst({
    where: eq(quotes.id, id),
    with: {
      deal: true,
      company: true,
      contact: true,
      owner: { columns: USER_SUMMARY_COLUMNS },
      items: { with: { product: true } },
      activities: {
        with: { user: { columns: USER_SUMMARY_COLUMNS } },
        orderBy: desc(quoteActivities.createdAt),
      },
    },
  });

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
  const lang = documentLanguage(q.company);
  const seller = await sellerIdentity(db, workspaceName);
  if (!seller.email && q.owner?.email) seller.email = q.owner.email;
  const buffer = await renderToBuffer(<QuotePDF quote={q} seller={seller} lang={lang} />);
  const fileName = `${QUOTE_TEXT[lang].documentTitle}-${q.quoteNumber}`.replace(/[^A-Za-z0-9-]/g, "-");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

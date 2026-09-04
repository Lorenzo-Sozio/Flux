import { type NextRequest, NextResponse } from "next/server";

import { renderToBuffer } from "@react-pdf/renderer";
import { desc, eq } from "drizzle-orm";

import { QuotePDF } from "@/components/pdf/quote-pdf";
import { APP_CONFIG } from "@/config/app-config";
import { quoteActivities, quotes } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();

  const q = await db.query.quotes.findFirst({
    where: eq(quotes.id, id),
    with: {
      deal: true,
      company: true,
      contact: true,
      owner: true,
      items: { with: { product: true } },
      activities: {
        with: { user: true },
        orderBy: desc(quoteActivities.createdAt),
      },
    },
  });

  if (!q) return new NextResponse("Not found", { status: 404 });

  // Auth: session OR public token
  const token = req.nextUrl.searchParams.get("token");
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

  const buffer = await renderToBuffer(
    <QuotePDF quote={q} sellerName={APP_CONFIG.name} sellerEmail={q.owner?.email ?? undefined} />,
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${q.quoteNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

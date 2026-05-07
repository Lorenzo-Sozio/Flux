import { type NextRequest, NextResponse } from "next/server";

import { renderToBuffer } from "@react-pdf/renderer";
import { desc, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { QuotePDF } from "@/components/pdf/quote-pdf";
import { APP_CONFIG } from "@/config/app-config";
import { db } from "@/db";
import { quoteActivities, quotes } from "@/db/schema";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
    const session = await auth();
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const canView =
      session.user.id === q.ownerId ||
      session.user.id === q.deal?.ownerId ||
      session.user.role === "admin" ||
      session.user.role === "owner";
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

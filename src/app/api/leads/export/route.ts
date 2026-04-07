import { auth } from "@/auth";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { unparse } from "papaparse";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isPrivileged = session.user.role === "admin" || session.user.role === "owner";

  // Admins/owners export all leads; regular users export only their own.
  const rows = isPrivileged
    ? await db.select().from(leads)
    : await db.select().from(leads).where(eq(leads.ownerId, session.user.id));

  const csvData = rows.map((r) => ({
    ...r,
    tags: r.tags ? r.tags.join(";") : "",
    marketingConsent: r.marketingConsent ? "yes" : "no",
    isConverted: r.isConverted ? "yes" : "no",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
  }));

  const csv = unparse(csvData);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}

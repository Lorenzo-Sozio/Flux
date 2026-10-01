import { NextResponse } from "next/server";

import { unparse } from "papaparse";

import { auth } from "@/auth";
import { leads } from "@/db/schema";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

export async function GET() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ What the person may see, by the rules every list follows (src/lib/record-visibility.ts):
  // an export is the list in a file. It used to be "your own rows unless you are an administrator",
  // a rule of its own that left out the group's records and the unassigned ones.
  const visible = visibleWhere("lead", await recordScope());

  const rows = await db.select().from(leads).where(visible);

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

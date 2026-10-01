import { NextResponse } from "next/server";

import { unparse } from "papaparse";

import { auth } from "@/auth";
import { companies } from "@/db/schema";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

export async function GET() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ What the person may see, by the rules every list follows (src/lib/record-visibility.ts):
  // an export is the list in a file. It used to be "your own rows unless you are an administrator",
  // a rule of its own that left out the group's records and the unassigned ones.
  const visible = visibleWhere("company", await recordScope());

  const baseQuery = db
    .select({
      id: companies.id,
      name: companies.name,
      industry: companies.industry,
      website: companies.website,
      description: companies.description,
      type: companies.type,
      employeeCount: companies.employeeCount,
      annualRevenue: companies.annualRevenue,
      street: companies.street,
      city: companies.city,
      state: companies.state,
      zipCode: companies.zipCode,
      country: companies.country,
      mainPhone: companies.mainPhone,
      mainEmail: companies.mainEmail,
      linkedinUrl: companies.linkedinUrl,
      status: companies.status,
      source: companies.source,
      leadScore: companies.leadScore,
      vatNumber: companies.vatNumber,
      sdiCode: companies.sdiCode,
      language: companies.language,
      tags: companies.tags,
      createdAt: companies.createdAt,
    })
    .from(companies);

  const rows = await baseQuery.where(visible);

  const csvData = rows.map((r) => ({
    ...r,
    tags: r.tags ? r.tags.join(";") : "",
    annualRevenue: r.annualRevenue ?? "",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  const csv = unparse(csvData);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="companies-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}

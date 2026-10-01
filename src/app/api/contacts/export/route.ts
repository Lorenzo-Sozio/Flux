import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import { unparse } from "papaparse";

import { auth } from "@/auth";
import { companies, contacts } from "@/db/schema";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

export async function GET() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ What the person may see, by the rules every list follows (src/lib/record-visibility.ts):
  // an export is the list in a file. It used to be "your own rows unless you are an administrator",
  // a rule of its own that left out the group's records and the unassigned ones.
  const visible = visibleWhere("contact", await recordScope());

  const baseQuery = db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      mobile: contacts.mobile,
      jobTitle: contacts.jobTitle,
      department: contacts.department,
      company: companies.name,
      linkedinUrl: contacts.linkedinUrl,
      street: contacts.street,
      city: contacts.city,
      state: contacts.state,
      zipCode: contacts.zipCode,
      country: contacts.country,
      status: contacts.status,
      source: contacts.source,
      leadScore: contacts.leadScore,
      notes: contacts.notes,
      marketingConsent: contacts.marketingConsent,
      tags: contacts.tags,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id));

  const rows = await baseQuery.where(visible);

  const csvData = rows.map((r) => ({
    ...r,
    tags: r.tags ? r.tags.join(";") : "",
    marketingConsent: r.marketingConsent ? "yes" : "no",
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
  }));

  const csv = unparse(csvData);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}

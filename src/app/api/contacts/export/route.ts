import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import { unparse } from "papaparse";

import { auth } from "@/auth";
import { companies, contacts } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

export async function GET() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ The WORKSPACE role. `session.user.role` is Flux's own staff scale and reads
  // "user" for every customer, so this comparison was always false: the export returned
  // only the caller's own rows, to a workspace owner too. A CSV quietly incomplete is
  // worse than one that fails. See the two role scales in CLAUDE.md.
  const isPrivileged = can(await getActor(), "user:read");

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

  const rows = isPrivileged ? await baseQuery : await baseQuery.where(eq(contacts.ownerId, session.user.id));

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

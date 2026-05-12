import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import Papa from "papaparse";

import { auth } from "@/auth";
import { getDb } from "@/lib/tenant-context";
import { companies, contacts } from "@/db/schema";

// Rate limit: max 3 imports per 10 minutes per user
const importLimits = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting
  const key = session.user.id;
  const now = Date.now();
  const rl = importLimits.get(key);
  if (rl && now < rl.resetAt && rl.count >= 3) {
    return NextResponse.json({ error: "Too many imports. Try again later." }, { status: 429 });
  }
  if (!rl || now > rl.resetAt) {
    importLimits.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    rl.count++;
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const text = await file.text();
  const { data, errors } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (errors.length > 0) {
    return NextResponse.json({ error: "CSV parse error", details: errors }, { status: 400 });
  }

  let created = 0;
  let skipped = 0;
  const duplicates: string[] = [];

  for (const row of data) {
    const email = row.email?.trim().toLowerCase();
    const phone = row.phone?.trim();
    const firstName = row.firstName?.trim() || row.first_name?.trim();
    const lastName = row.lastName?.trim() || row.last_name?.trim();

    if (!firstName || !lastName) {
      skipped++;
      continue;
    }

    // Deduplication: check email + phone
    if (email) {
      const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email));
      if (existing) {
        duplicates.push(email);
        skipped++;
        continue;
      }
    }

    // Resolve company
    let companyId: string | undefined;
    if (row.company?.trim()) {
      const [co] = await db.select({ id: companies.id }).from(companies).where(eq(companies.name, row.company.trim()));
      if (co) {
        companyId = co.id;
      } else {
        // Create company on the fly
        const [newCo] = await db
          .insert(companies)
          .values({ name: row.company.trim(), ownerId: session.user!.id })
          .returning();
        companyId = newCo.id;
      }
    }

    const countryText = row.country?.trim() || null;
    const cityText = row.city?.trim() || null;

    await db.insert(contacts).values({
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
      mobile: row.mobile?.trim() || null,
      jobTitle: row.jobTitle?.trim() || row.job_title?.trim() || null,
      department: row.department?.trim() || null,
      linkedinUrl: row.linkedinUrl?.trim() || row.linkedin_url?.trim() || null,
      street: row.street?.trim() || null,
      city: cityText,
      state: row.state?.trim() || null,
      zipCode: row.zipCode?.trim() || row.zip_code?.trim() || null,
      country: countryText,
      source: row.source?.trim() || "import",
      notes: row.notes?.trim() || null,
      companyId: companyId ?? null,
      ownerId: session.user!.id,
      marketingConsent: row.marketingConsent === "yes" || row.marketing_consent === "yes",
      tags: row.tags
        ? row.tags
            .split(";")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    });

    created++;
  }

  return NextResponse.json({
    success: true,
    created,
    skipped,
    duplicates,
    total: data.length,
  });
}

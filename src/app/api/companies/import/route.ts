import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import Papa from "papaparse";

import { auth } from "@/auth";
import { getDb } from "@/lib/tenant-context";
import { companies } from "@/db/schema";

const importLimits = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting: max 3 imports per 10 min
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
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

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
    const name = row.name?.trim();
    if (!name) {
      skipped++;
      continue;
    }

    // Deduplication by exact name
    const [existing] = await db.select({ id: companies.id }).from(companies).where(eq(companies.name, name));

    if (existing) {
      duplicates.push(name);
      skipped++;
      continue;
    }

    const countryText = row.country?.trim() || null;
    const cityText = row.city?.trim() || null;

    await db.insert(companies).values({
      name,
      industry: row.industry?.trim() || null,
      website: row.website?.trim() || null,
      description: row.description?.trim() || null,
      type: row.type?.trim() || "prospect",
      employeeCount: row.employeeCount ? Number(row.employeeCount) : null,
      annualRevenue: row.annualRevenue?.trim() || null,
      street: row.street?.trim() || null,
      city: cityText,
      state: row.state?.trim() || null,
      zipCode: row.zipCode?.trim() || row.zip_code?.trim() || null,
      country: countryText,
      mainPhone: row.mainPhone?.trim() || row.main_phone?.trim() || null,
      mainEmail: row.mainEmail?.trim() || row.main_email?.trim() || null,
      linkedinUrl: row.linkedinUrl?.trim() || row.linkedin_url?.trim() || null,
      status: row.status?.trim() || "active",
      source: row.source?.trim() || "import",
      vatNumber: row.vatNumber?.trim() || row.vat_number?.trim() || null,
      sdiCode: row.sdiCode?.trim() || row.sdi_code?.trim() || null,
      tags: row.tags
        ? row.tags
            .split(";")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      ownerId: session.user!.id,
    });

    created++;
  }

  return NextResponse.json({ success: true, created, skipped, duplicates, total: data.length });
}

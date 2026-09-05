import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import { unparse } from "papaparse";

import { auth } from "@/auth";
import { leads } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

export async function GET() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ Il ruolo del WORKSPACE. `session.user.role` è la scala del personale di
  // Flux e vale "user" per ogni cliente, quindi questo confronto era sempre falso:
  // l'esportazione restituiva solo le righe di chi chiamava, anche al proprietario
  // del workspace. Un CSV incompleto in silenzio è peggio di uno che fallisce.
  // Vedi le due scale nel CLAUDE.md.
  const isPrivileged = can(await getActor(), "user:read");

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

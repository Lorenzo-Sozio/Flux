import { type NextRequest, NextResponse } from "next/server";

import { format } from "date-fns";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { auth } from "@/auth";
import { activities, companies, contacts, deals, leads, users } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

function esc(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...cells: (string | null | undefined)[]): string {
  return cells.map(esc).join(",");
}

/**
 * The activity report as CSV: the calls, meetings, emails and notes logged in the period.
 *
 * ⚠️⚠️ It exported `user_activity_log`, which nothing in the product writes: every file it
 * ever produced was a header and nothing else. Same table as the Activity tab reads now.
 */
export async function GET(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ The WORKSPACE role, not the platform one. See the two scales in CLAUDE.md.
  const actor = await getActor();
  if (!can(actor, "report:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const userId = req.nextUrl.searchParams.get("userId");

  const when = sql<Date>`coalesce(${activities.date}, ${activities.createdAt})`;

  try {
    const conditions = [
      ...(from ? [gte(when, new Date(from))] : []),
      ...(to ? [lte(when, new Date(`${to}T23:59:59`))] : []),
      ...(userId ? [eq(activities.ownerId, userId)] : []),
    ];

    const rows = await db
      .select({
        when,
        type: activities.type,
        content: activities.content,
        durationMinutes: activities.durationMinutes,
        userName: users.name,
        userEmail: users.email,
        leadFirst: leads.firstName,
        leadLast: leads.lastName,
        contactFirst: contacts.firstName,
        contactLast: contacts.lastName,
        companyName: companies.name,
        dealName: deals.name,
      })
      .from(activities)
      .leftJoin(users, eq(activities.ownerId, users.id))
      .leftJoin(leads, eq(activities.leadId, leads.id))
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      .leftJoin(companies, eq(activities.companyId, companies.id))
      .leftJoin(deals, eq(activities.dealId, deals.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(when))
      .limit(10000);

    const header = row("Date", "User", "Email", "Type", "Lead", "Contact", "Company", "Deal", "Minutes", "Content");
    const lines = rows.map((r) =>
      row(
        format(new Date(r.when), "yyyy-MM-dd HH:mm"),
        r.userName ?? "",
        r.userEmail ?? "",
        r.type,
        [r.leadFirst, r.leadLast].filter(Boolean).join(" "),
        [r.contactFirst, r.contactLast].filter(Boolean).join(" "),
        r.companyName ?? "",
        r.dealName ?? "",
        r.durationMinutes != null ? String(r.durationMinutes) : "",
        r.content ?? "",
      ),
    );

    const csv = [header, ...lines].join("\r\n");
    const filename = `activities-${from ?? "all"}-to-${to ?? "now"}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[reports/export] failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

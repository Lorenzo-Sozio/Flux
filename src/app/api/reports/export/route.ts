import { type NextRequest, NextResponse } from "next/server";

import { format } from "date-fns";
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { auth } from "@/auth";
import { userActivityLogs, users } from "@/db/schema";
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

const ACTION_LABELS: Record<string, string> = {
  login: "Login",
  create_deal: "Create Deal",
  update_deal: "Update Deal",
  win_deal: "Win Deal",
  lose_deal: "Lose Deal",
  delete_deal: "Delete Deal",
  create_lead: "Create Lead",
  update_lead: "Update Lead",
  convert_lead: "Convert Lead",
  delete_lead: "Delete Lead",
  create_contact: "Create Contact",
  update_contact: "Update Contact",
  delete_contact: "Delete Contact",
  create_company: "Create Company",
  create_task: "Create Task",
  complete_task: "Complete Task",
  delete_task: "Delete Task",
  create_quote: "Create Quote",
  send_quote: "Send Quote",
  accept_quote: "Accept Quote",
  delete_quote: "Delete Quote",
  create_ticket: "Create Ticket",
  resolve_ticket: "Resolve Ticket",
  close_ticket: "Close Ticket",
  launch_campaign: "Launch Campaign",
};

export async function GET(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ⚠️⚠️ The WORKSPACE role, not the platform one. This line read `session.user.role`,
  // which is Flux's own staff scale and reads "user" for every customer: the list never
  // contained its value, so exporting the activity log was forbidden to everybody, the
  // workspace owner included, while staying open to Flux's own staff. It did not look like
  // an error. It looked like a feature that is not there. See the two scales in CLAUDE.md.
  const actor = await getActor();
  if (!can(actor, "report:manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const userId = req.nextUrl.searchParams.get("userId");

  try {
    const conditions = [
      ...(from ? [gte(userActivityLogs.createdAt, new Date(from))] : []),
      ...(to ? [lte(userActivityLogs.createdAt, new Date(`${to}T23:59:59`))] : []),
      ...(userId ? [eq(userActivityLogs.userId, userId)] : []),
    ];

    const logs = await db
      .select({
        id: userActivityLogs.id,
        createdAt: userActivityLogs.createdAt,
        action: userActivityLogs.action,
        entityType: userActivityLogs.entityType,
        entityId: userActivityLogs.entityId,
        ipAddress: userActivityLogs.ipAddress,
        userId: userActivityLogs.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(userActivityLogs)
      .leftJoin(users, eq(userActivityLogs.userId, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(userActivityLogs.createdAt))
      .limit(10000);

    console.info("[reports/export] rows=%d from=%s to=%s userId=%s", logs.length, from, to, userId);

    const header = row("Timestamp", "User", "Email", "Action", "Entity Type", "Entity ID", "IP Address");
    const lines = logs.map((l) =>
      row(
        format(new Date(l.createdAt), "yyyy-MM-dd HH:mm:ss"),
        l.userName ?? "",
        l.userEmail ?? "",
        ACTION_LABELS[l.action] ?? l.action,
        l.entityType ?? "",
        l.entityId ?? "",
        l.ipAddress ?? "",
      ),
    );

    const csv = [header, ...lines].join("\r\n");
    const filename = `activity-report-${from ?? "all"}-to-${to ?? "now"}.csv`;

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

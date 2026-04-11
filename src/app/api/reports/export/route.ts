import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { userActivityLogs, users } from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { format } from "date-fns";

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
  login: "Login", create_deal: "Create Deal", update_deal: "Update Deal",
  win_deal: "Win Deal", lose_deal: "Lose Deal", delete_deal: "Delete Deal",
  create_lead: "Create Lead", update_lead: "Update Lead", convert_lead: "Convert Lead",
  delete_lead: "Delete Lead", create_contact: "Create Contact", update_contact: "Update Contact",
  delete_contact: "Delete Contact", create_company: "Create Company",
  create_task: "Create Task", complete_task: "Complete Task", delete_task: "Delete Task",
  create_quote: "Create Quote", send_quote: "Send Quote", accept_quote: "Accept Quote",
  delete_quote: "Delete Quote", create_ticket: "Create Ticket",
  resolve_ticket: "Resolve Ticket", close_ticket: "Close Ticket",
  launch_campaign: "Launch Campaign",
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (!["admin", "owner"].includes(role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from   = req.nextUrl.searchParams.get("from");
  const to     = req.nextUrl.searchParams.get("to");
  const userId = req.nextUrl.searchParams.get("userId");

  try {
    const conditions = [
      ...(from   ? [gte(userActivityLogs.createdAt, new Date(from))] : []),
      ...(to     ? [lte(userActivityLogs.createdAt, new Date(`${to}T23:59:59`))] : []),
      ...(userId ? [eq(userActivityLogs.userId, userId)] : []),
    ];

    const logs = await db
      .select({
        id:         userActivityLogs.id,
        createdAt:  userActivityLogs.createdAt,
        action:     userActivityLogs.action,
        entityType: userActivityLogs.entityType,
        entityId:   userActivityLogs.entityId,
        ipAddress:  userActivityLogs.ipAddress,
        userId:     userActivityLogs.userId,
        userName:   users.name,
        userEmail:  users.email,
      })
      .from(userActivityLogs)
      .leftJoin(users, eq(userActivityLogs.userId, users.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(userActivityLogs.createdAt))
      .limit(10000);

    console.info("[reports/export] rows=%d from=%s to=%s userId=%s", logs.length, from, to, userId);

    const header = row("Timestamp", "User", "Email", "Action", "Entity Type", "Entity ID", "IP Address");
    const lines  = logs.map((l) =>
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

    const csv      = [header, ...lines].join("\r\n");
    const filename = `activity-report-${from ?? "all"}-to-${to ?? "now"}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (err) {
    console.error("[reports/export] failed", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

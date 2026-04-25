import { db } from "@/db";
import { tickets } from "@/db/schema";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { runAutomations } from "@/components/crm/automation/rule-engine";

const OPEN_STATUSES = ["new", "open", "in_progress"];

export async function GET(req: Request) {
  const secret = req.headers.get("authorization");
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Find tickets that have passed their SLA deadline but haven't been marked breached yet
  const breached = await db.query.tickets.findMany({
    where: and(
      isNotNull(tickets.slaDeadlineAt),
      isNull(tickets.slaBreachedAt),
      lt(tickets.slaDeadlineAt!, now),
    ),
  });

  // Exclude tickets where SLA is currently paused (waiting / on_hold)
  const active = breached.filter((t) => OPEN_STATUSES.includes(t.status) && !t.slaPausedAt);

  if (active.length === 0) {
    return NextResponse.json({ breached: 0 });
  }

  // Mark as breached
  await Promise.all(
    active.map((t) =>
      db
        .update(tickets)
        .set({ slaBreachedAt: now, updatedAt: now })
        .where(eq(tickets.id, t.id)),
    ),
  );

  // Fire automations for each breached ticket (fire-and-forget)
  for (const t of active) {
    runAutomations({
      entityType:    "ticket",
      entityId:      t.id,
      event:         "onSLABreach",
      oldData:       t as Record<string, unknown>,
      newData:       { ...t, slaBreachedAt: now } as Record<string, unknown>,
    }).catch((err) => console.error("[SLA cron] automation error:", err));
  }

  return NextResponse.json({ breached: active.length });
}

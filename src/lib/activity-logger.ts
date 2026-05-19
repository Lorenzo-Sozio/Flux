"use server";

import { headers } from "next/headers";

import { auth } from "@/auth";
import { userActivityLogs } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

export type ActivityAction =
  | "login"
  | "create_lead"
  | "update_lead"
  | "delete_lead"
  | "convert_lead"
  | "create_contact"
  | "update_contact"
  | "delete_contact"
  | "create_company"
  | "update_company"
  | "delete_company"
  | "create_deal"
  | "update_deal"
  | "delete_deal"
  | "win_deal"
  | "lose_deal"
  | "create_task"
  | "complete_task"
  | "delete_task"
  | "create_quote"
  | "send_quote"
  | "accept_quote"
  | "delete_quote"
  | "create_ticket"
  | "resolve_ticket"
  | "close_ticket"
  | "launch_campaign"
  | "create_automation"
  | "trigger_automation";

/**
 * Logs a user activity to the audit trail.
 * Call this from server actions after key mutations.
 * Failures are silent — never let logging break the main operation.
 */
export async function logActivity(
  action: ActivityAction,
  options?: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    // Resolve userId: explicit > session > null (for system events)
    let userId = options?.userId ?? null;
    if (!userId) {
      const session = await auth().catch(() => null);
      userId = session?.user?.id ?? null;
    }

    const hdrs = await headers().catch(() => null);
    const ipAddress = hdrs?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs?.get("x-real-ip") ?? null;

    const db = await getDb();
    await db.insert(userActivityLogs).values({
      userId,
      action,
      entityType: options?.entityType ?? null,
      entityId: options?.entityId ?? null,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
      ipAddress,
    });
  } catch {
    // Silent — audit logging must never break the caller
  }
}

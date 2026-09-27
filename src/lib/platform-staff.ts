import { inArray } from "drizzle-orm";

import { platformDb } from "@/db";
import { users } from "@/db/schema";
import { sendWorkspaceRequestEmail } from "@/lib/email";

/**
 * Flux's own staff — the people who create workspaces — and telling them somebody needs one.
 *
 * ⚠️ This is the one place that reads `users.role` on purpose: it *is* the platform scale.
 * A workspace's people are found with `membersWith` (src/lib/workspace-members.ts), never
 * here; `role-comparisons.test.ts` enforces the difference and names this file.
 */
async function platformStaffEmails(): Promise<string[]> {
  const rows = await platformDb
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.role, ["admin", "owner"]));
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}

/**
 * A new account with no workspace is a request for one.
 *
 * ⚠️⚠️ Signing up used to end on "No workspaces found… contact an administrator", and no
 * administrator was told anything: a workspace can only be created from the platform panel,
 * so the person who had just signed up waited for an answer to a question nobody had
 * received. Best-effort, and never fails the sign-up: the account exists either way, and the
 * platform panel lists accounts without a workspace.
 */
export async function announceAccountWithoutWorkspace(person: { name: string | null; email: string }): Promise<void> {
  try {
    const staff = await platformStaffEmails();
    if (staff.length === 0) {
      console.warn(`[signup] ${person.email} has no workspace, and there is no platform staff to tell`);
      return;
    }
    await sendWorkspaceRequestEmail(staff, person);
  } catch (err) {
    console.error(`[signup] could not tell the platform staff about ${person.email}:`, err);
  }
}

/**
 * auth-guard.ts
 * Server-side helpers to enforce role-based access in Server Actions.
 * Call these at the top of any mutation action.
 */
import { auth } from "@/auth";

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Returns the current session or throws if unauthenticated. */
async function getSessionOrThrow() {
  const session = await auth();
  if (!session?.user?.id) throw new ForbiddenError("You must be logged in.");
  return session;
}

/**
 * Requires at least "user" role.
 * Viewers are read-only and cannot mutate any record.
 */
export async function requireWriteAccess() {
  const session = await getSessionOrThrow();
  const role = session.user.role as string | undefined;
  if (role === "viewer") {
    throw new ForbiddenError("Viewers cannot make changes.");
  }
  return session;
}

/**
 * Requires "admin" or "owner" role.
 * Used for privileged operations: user management, webhooks, custom fields, settings.
 */
export async function requireAdminAccess() {
  const session = await getSessionOrThrow();
  const role = session.user.role as string | undefined;
  if (role !== "admin" && role !== "owner") {
    throw new ForbiddenError("Only administrators can perform this action.");
  }
  return session;
}

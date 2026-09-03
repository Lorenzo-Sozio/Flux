/**
 * action-error.ts — carrying a refusal from the server to the person who caused it.
 *
 * Every modal in the product ended in `catch { toast.error(t("form.saveFailed")) }`.
 * "You are read-only", "you have reached your plan's record limit" and "the
 * network died" all arrived as the same sentence, leaving the user with no idea
 * whether to retry, ask an admin, or upgrade (audit rilievo U-01).
 *
 * The guards already produce good messages. The problem is that Next.js replaces
 * the message of an error thrown inside a Server Action with a generic string in
 * production, so throwing is not enough on its own: the action has to *return*
 * the refusal. `guarded()` does that, and `actionErrorMessage()` reads it back on
 * the client, so a call site changes by two lines rather than being rewritten.
 */
/**
 * Pure module — no server imports.
 *
 * The client half of this file runs in the browser, so it must not reach into
 * `auth-guard`: that would drag `next/headers`, the session and the database
 * into every bundle that shows a toast. Errors are therefore classified by
 * `name`, which is also what survives the serialisation boundary between a
 * Server Action and the component that called it.
 */

export type ActionErrorCode = "FORBIDDEN" | "UNAUTHENTICATED" | "PLAN_LIMIT" | "VALIDATION" | "UNKNOWN";

export interface ActionFailure {
  ok: false;
  code: ActionErrorCode;
  /** Written for the person reading it, not for a log. */
  message: string;
  /** Present for PLAN_LIMIT, so the UI can offer the upgrade directly. */
  upgradePath?: string;
}

export type ActionResult<T> = ({ ok: true } & T) | ActionFailure;

/** Classifies a thrown error into something the client can act on. */
export function toActionFailure(error: unknown): ActionFailure {
  const name = error && typeof error === "object" && "name" in error ? String((error as Error).name) : "";
  const message = error instanceof Error ? error.message : "";

  if (name === "ForbiddenError") {
    return { ok: false, code: "FORBIDDEN", message };
  }
  if (name === "UnauthenticatedError") {
    return { ok: false, code: "UNAUTHENTICATED", message };
  }
  if (name === "EntitlementError") {
    return {
      ok: false,
      code: "PLAN_LIMIT",
      message,
      upgradePath: "/dashboard/settings/billing",
    };
  }
  if (name === "ZodError") {
    const issues = (error as unknown as { errors?: { message?: string }[] }).errors ?? [];
    return { ok: false, code: "VALIDATION", message: issues[0]?.message ?? "Some fields need attention." };
  }

  // Anything else is genuinely unexpected. The real message goes to the server
  // log; the client gets something true but not internal.
  console.error("[action]", error);
  return { ok: false, code: "UNKNOWN", message: "Something went wrong on our side. Please try again." };
}

/**
 * Wraps a Server Action body so expected refusals come back as data.
 *
 *   export async function createContact(data: unknown) {
 *     return guarded(async () => {
 *       await requireCapability("record:write");
 *       …
 *       return { contact };
 *     });
 *   }
 */
export async function guarded<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ─── Client side ──────────────────────────────────────────────────────────────

/**
 * The message to show for a failed action, whether it came back as a returned
 * failure or as a thrown error.
 *
 * `fallback` is the caller's own generic string, used only when there is genuinely
 * nothing better — which, after this change, is rare.
 */
export function actionErrorMessage(result: unknown, fallback: string): string {
  if (result && typeof result === "object") {
    const r = result as Partial<ActionFailure> & { message?: string; error?: string };
    if (typeof r.message === "string" && r.message.trim()) return r.message;
    if (typeof r.error === "string" && r.error.trim()) return r.error;
  }
  if (result instanceof Error && result.message && !isRedactedByNext(result.message)) {
    return result.message;
  }
  return fallback;
}

/**
 * True when the string is Next's production stand-in rather than a real message.
 * Showing it would be worse than the caller's own fallback.
 */
const REDACTED_MARKERS = [
  "An error occurred in the Server Components render",
  "An unexpected response was received from the server",
];

function isRedactedByNext(message: string): boolean {
  return REDACTED_MARKERS.some((marker) => message.includes(marker));
}

/** True when the failure is a plan limit, so the caller can offer an upgrade. */
export function isPlanLimit(result: unknown): result is ActionFailure {
  return Boolean(result && typeof result === "object" && (result as ActionFailure).code === "PLAN_LIMIT");
}

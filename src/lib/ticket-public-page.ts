import "server-only";

import { notify } from "@/lib/notify";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveTenantBySubdomain } from "@/lib/tenant-resolve";
import { loadStatusPage, rateTicket, type StatusPage } from "@/lib/ticket-public";
import { dispatchWebhook } from "@/lib/webhook-dispatch";

/**
 * The status page and the rating, for a customer with no session (src/lib/ticket-public.ts).
 * The workspace comes from the address, the ticket from the token; the notification is
 * written inside `runWithTenant`, because there is no request to read the workspace from.
 */

export async function loadTicketStatus(
  workspace: string,
  token: string,
): Promise<{ page: StatusPage; workspaceName: string } | null> {
  const found = await resolveTenantBySubdomain(workspace);
  if (!found) return null;
  const page = await loadStatusPage(found.db, token);
  return page ? { page, workspaceName: found.tenant.name ?? workspace } : null;
}

export type SubmitRating = { ok: true } | { ok: false; reason: "notFound" | "notYet" | "invalid" };

export async function submitTicketRating(body: Record<string, unknown>): Promise<SubmitRating> {
  const workspace = typeof body.workspace === "string" ? body.workspace : "";
  const found = workspace ? await resolveTenantBySubdomain(workspace) : null;
  if (!found) return { ok: false, reason: "notFound" };
  const result = await rateTicket(found.db, { token: body.token, rating: body.rating, comment: body.comment });
  if (!result.ok) return result;

  // Every change of answer, good or bad; a repeat is not an event.
  if (result.changed) {
    await dispatchWebhook(
      "ticket.rated",
      { ticket: { id: result.ticketId, number: result.ticketNumber }, rating: result.rating },
      { via: "user", actor: null },
      found.db as never,
    ).catch((err) => console.error("[ticket-rating] ticket.rated not dispatched", err));
  }

  // A bad answer reaches whoever handled it — once, not on every reload of the page.
  if (result.rating === "bad" && result.changed && result.notifyUserId) {
    const userId = result.notifyUserId;
    await runWithTenant(found.tenant.id, () =>
      notify({
        userId,
        type: "ticket_rated_bad",
        key: "ticketRatedBad",
        params: { ticket: result.ticketNumber },
        link: `/dashboard/support/tickets/${result.ticketId}`,
      }),
    ).catch((err) => console.error("[ticket-rating] recorded, not notified:", err));
  }
  return { ok: true };
}

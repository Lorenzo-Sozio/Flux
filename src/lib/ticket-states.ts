/**
 * The states a ticket is finished in. Everything else is open — `new` and `on_hold`
 * included: every ticket arrives as `new`, and leaving it out made an email that had just
 * come in not count as open anywhere it was counted.
 *
 * Pure, so a client component can ask the same question the server does.
 */
export const CLOSED_TICKET_STATUSES = ["resolved", "closed"] as const;

export function isTicketOpen(status: string): boolean {
  return !(CLOSED_TICKET_STATUSES as readonly string[]).includes(status);
}

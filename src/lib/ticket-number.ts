import crypto from "node:crypto";

/**
 * A new ticket's number, `TKT-yyyymm-XXXXXX`: what a customer quotes back in a subject line,
 * and what inbound email routes a reply by. Shared by inbound email and the support form.
 */
export function generateTicketNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TKT-${year}${month}-${random}`;
}

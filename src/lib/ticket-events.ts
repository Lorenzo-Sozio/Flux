/**
 * What a ticket event carries (ticket.created, ticket.resolved): the same fields from every
 * door a ticket comes through, so a receiver reads one shape. Pure.
 */
export function ticketEventPayload(t: {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  contactId: string | null;
  companyId: string | null;
  assigneeId: string | null;
}) {
  return {
    id: t.id,
    number: t.ticketNumber,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: t.channel,
    contactId: t.contactId,
    companyId: t.companyId,
    assigneeId: t.assigneeId,
  };
}

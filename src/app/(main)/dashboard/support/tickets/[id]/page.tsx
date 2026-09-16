import { getMacros, getTicketById } from "@/actions/support";
import { RecordVisit } from "@/components/crm/record-visit";

import { TicketDetail } from "./_components/ticket-detail";

/**
 * Loads the ticket and the saved replies on the server, so the screen draws with
 * the conversation already in it instead of a skeleton that waits for the browser
 * to ask.
 *
 * ⚠️ Failures are caught rather than thrown. A ticket the server could not load
 * reaches the client as `null`, and the screen then loads it itself and shows its
 * own "not found" — the behaviour this page had before, rather than an error page
 * on the one screen an agent is trying to answer from.
 */
export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, macros] = await Promise.all([getTicketById(id).catch(() => null), getMacros().catch(() => [])]);
  return (
    <>
      {ticket && <RecordVisit type="ticket" id={id} label={ticket.subject} sub={ticket.ticketNumber} />}
      <TicketDetail id={id} initialTicket={ticket} initialMacros={macros} />
    </>
  );
}

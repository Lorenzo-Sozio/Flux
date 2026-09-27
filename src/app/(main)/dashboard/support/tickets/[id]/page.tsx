import { getMacros, getTicketById } from "@/actions/support";
import { auth } from "@/auth";
import { RecordVisit } from "@/components/crm/record-visit";
import { can } from "@/lib/permissions";

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
 *
 * The capabilities are decided here, from the workspace role, and handed down: a
 * viewer reads the ticket and is not offered the reply box, the status controls
 * or the delete that the server would refuse anyway.
 */
export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, macros, session] = await Promise.all([
    getTicketById(id).catch(() => null),
    getMacros().catch(() => []),
    auth(),
  ]);
  // ⚠️ The workspace role, never `session.user.role` — that is Flux's own staff
  // scale and reads "user" for every customer. See CLAUDE.md on the two scales.
  const tenantRole = session?.user?.tenantRole ?? null;
  return (
    <>
      {ticket && <RecordVisit type="ticket" id={id} label={ticket.subject} sub={ticket.ticketNumber} />}
      <TicketDetail
        id={id}
        initialTicket={ticket}
        initialMacros={macros}
        canWrite={can(tenantRole, "ticket:write")}
        canDelete={can(tenantRole, "ticket:delete")}
      />
    </>
  );
}

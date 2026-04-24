import { db } from "@/db"
import { ticketAuditLogs } from "@/db/schema"

interface LogTicketChangeParams {
  ticketId: string
  actorId?: string
  actorName?: string
  action: string
  field?: string
  oldValue?: string
  newValue?: string
}

export async function logTicketChange(params: LogTicketChangeParams) {
  await db.insert(ticketAuditLogs).values({
    ticketId: params.ticketId,
    actorId: params.actorId,
    actorName: params.actorName,
    action: params.action,
    field: params.field,
    oldValue: params.oldValue,
    newValue: params.newValue,
  })
}

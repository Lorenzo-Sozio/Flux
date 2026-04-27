"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, desc, eq, isNotNull, lt, notInArray } from "drizzle-orm";
import type { z } from "zod";

import {
  AddMessageSchema,
  CreateMacroSchema,
  CreateSLASchema,
  CreateTicketSchema,
  UpdateMacroSchema,
  UpdateSLASchema,
  UpdateTicketSchema,
} from "@/actions/support-validation";
import { auth } from "@/auth";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import { db } from "@/db";
import {
  chatChannels,
  chatSessions,
  contacts,
  slas,
  ticketAuditLogs,
  ticketMacros,
  ticketMessages,
  tickets,
  users,
} from "@/db/schema";
import { sendEmail } from "@/lib/email-provider";
import { logTicketChange } from "@/lib/ticket-audit";
import { canTransition, isSLAPauseStatus } from "@/lib/ticket-state-machine";

import crypto from "node:crypto";

// --- HELPERS ---

function generateTicketNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TKT-${year}${month}-${random}`;
}

async function calculateSLADeadline(slaId: string | null | undefined): Promise<Date | null> {
  if (!slaId) return null;

  const sla = await db.query.slas.findFirst({
    where: eq(slas.id, slaId),
  });

  if (!sla) return null;

  return new Date(Date.now() + sla.resolutionTimeMinutes * 60000);
}

// --- MAIN ACTIONS ---

export async function createTicketAction(data: z.infer<typeof CreateTicketSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const validated = CreateTicketSchema.parse(data);
  const ticketNumber = generateTicketNumber();
  const slaDeadlineAt = await calculateSLADeadline(null);

  const [ticket] = await db
    .insert(tickets)
    .values({
      ticketNumber,
      subject: validated.subject,
      description: validated.description,
      channel: validated.channel,
      priority: validated.priority,
      severity: validated.severity,
      status: "new",
      type: validated.type,
      component: validated.component,
      groupId: validated.groupId,
      contactId: validated.contactId,
      companyId: validated.companyId,
      leadId: validated.leadId,
      assigneeId: validated.assigneeId,
      ownerId: session.user.id,
      tags: validated.tags,
      slaDeadlineAt,
    })
    .returning();

  await logTicketChange({
    ticketId: ticket.id,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    action: "created",
    newValue: ticketNumber,
  });

  revalidatePath("/dashboard/support/tickets");
  revalidatePath("/dashboard/support");

  after(() =>
    runAutomations({
      entityType: "ticket",
      entityId: ticket.id,
      event: "onCreate",
      oldData: {},
      newData: ticket as Record<string, unknown>,
      currentUserId: session.user.id,
    }),
  );

  return { success: true, ticketId: ticket.id, ticketNumber };
}

export async function getTicketById(ticketId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
    with: {
      contact: true,
      company: true,
      assignee: true,
      owner: true,
      sla: true,
      group: true,
      messages: {
        orderBy: desc(ticketMessages.createdAt),
        with: {
          sender: true,
        },
      },
      auditLogs: {
        orderBy: desc(ticketAuditLogs.createdAt),
        with: {
          actor: true,
        },
      },
    },
  });

  if (!ticket) throw new Error("Ticket not found");

  return ticket;
}

export async function getTickets(options?: { limit?: number; status?: string }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticketList = await db.query.tickets.findMany({
    orderBy: desc(tickets.createdAt),
    limit: options?.limit || 100,
    with: {
      contact: true,
      company: true,
      assignee: true,
      messages: {
        limit: 1,
        orderBy: desc(ticketMessages.createdAt),
      },
    },
  });

  return ticketList;
}

export async function getTicketsByStatus(status: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticketList = await db.query.tickets.findMany({
    where: eq(tickets.status, status),
    orderBy: desc(tickets.createdAt),
    with: {
      contact: true,
      company: true,
      assignee: true,
      messages: {
        limit: 1,
        orderBy: desc(ticketMessages.createdAt),
      },
    },
  });

  return ticketList;
}

export async function updateTicketAction(ticketId: string, data: z.infer<typeof UpdateTicketSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const validated = UpdateTicketSchema.parse(data);
  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });

  if (!ticket) throw new Error("Ticket not found");

  if (session.user.id !== ticket.ownerId && session.user.id !== ticket.assigneeId && session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }

  const actorName = session.user.name ?? session.user.email ?? undefined;
  const now = new Date();
  const updateData: Record<string, unknown> = { updatedAt: now };

  if (validated.subject) updateData.subject = validated.subject;
  if (validated.description !== undefined) updateData.description = validated.description;
  if (validated.type !== undefined) updateData.type = validated.type;
  if (validated.component !== undefined) updateData.component = validated.component;
  if (validated.groupId !== undefined) updateData.groupId = validated.groupId;

  if (validated.status) {
    if (!canTransition(ticket.status, validated.status)) {
      throw new Error(`Invalid transition: ${ticket.status} → ${validated.status}`);
    }
    updateData.status = validated.status;
    if (validated.status === "resolved") updateData.resolvedAt = now;
    if (validated.status === "closed") updateData.closedAt = now;

    // SLA pause/resume
    if (isSLAPauseStatus(validated.status) && !ticket.slaPausedAt) {
      updateData.slaPausedAt = now;
    } else if (!isSLAPauseStatus(validated.status) && ticket.slaPausedAt) {
      const pausedMs = now.getTime() - ticket.slaPausedAt.getTime();
      updateData.slaPauseMinutes = (ticket.slaPauseMinutes ?? 0) + Math.floor(pausedMs / 60000);
      updateData.slaPausedAt = null;
    }
  }

  if (validated.priority) updateData.priority = validated.priority;
  if (validated.severity) updateData.severity = validated.severity;
  if (validated.assigneeId !== undefined) {
    updateData.assigneeId = validated.assigneeId;
    if (validated.assigneeId && !ticket.firstResponseAt) {
      updateData.firstResponseAt = now;
    }
  }
  if (validated.tags) updateData.tags = validated.tags;

  const [updated] = await db.update(tickets).set(updateData).where(eq(tickets.id, ticketId)).returning();

  // Audit log changed fields
  const auditPromises: Promise<void>[] = [];
  if (validated.status && validated.status !== ticket.status) {
    auditPromises.push(
      logTicketChange({
        ticketId,
        actorId: session.user.id,
        actorName,
        action: "status_changed",
        field: "status",
        oldValue: ticket.status,
        newValue: validated.status,
      }),
    );
  }
  if (validated.priority && validated.priority !== ticket.priority) {
    auditPromises.push(
      logTicketChange({
        ticketId,
        actorId: session.user.id,
        actorName,
        action: "priority_changed",
        field: "priority",
        oldValue: ticket.priority,
        newValue: validated.priority,
      }),
    );
  }
  if (validated.assigneeId !== undefined && validated.assigneeId !== ticket.assigneeId) {
    auditPromises.push(
      logTicketChange({
        ticketId,
        actorId: session.user.id,
        actorName,
        action: "assigned",
        field: "assigneeId",
        oldValue: ticket.assigneeId ?? undefined,
        newValue: validated.assigneeId ?? undefined,
      }),
    );
  }
  await Promise.all(auditPromises);

  revalidatePath("/dashboard/support/tickets");
  revalidatePath(`/dashboard/support/tickets/${ticketId}`);

  after(() =>
    runAutomations({
      entityType: "ticket",
      entityId: ticketId,
      event: "onUpdate",
      oldData: ticket as Record<string, unknown>,
      newData: updated as Record<string, unknown>,
      currentUserId: session.user.id,
    }),
  );

  return { success: true, ticket: updated };
}

export async function addTicketMessageAction(ticketId: string, data: z.infer<typeof AddMessageSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const validated = AddMessageSchema.parse(data);
  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });

  if (!ticket) throw new Error("Ticket not found");

  if (session.user.id !== ticket.ownerId && session.user.id !== ticket.assigneeId && session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }

  // Reply to closed ticket → open new linked ticket instead
  if (ticket.status === "closed") {
    const newNumber = generateTicketNumber();
    const [newTicket] = await db
      .insert(tickets)
      .values({
        ticketNumber: newNumber,
        subject: `Re: ${ticket.subject}`,
        description: validated.content,
        channel: ticket.channel,
        priority: ticket.priority,
        severity: ticket.severity,
        status: "open",
        type: ticket.type,
        contactId: ticket.contactId,
        companyId: ticket.companyId,
        assigneeId: ticket.assigneeId,
        ownerId: session.user.id,
        parentTicketId: ticket.id,
      })
      .returning();

    await logTicketChange({
      ticketId: newTicket.id,
      actorId: session.user.id,
      actorName: session.user.name ?? session.user.email ?? undefined,
      action: "created",
      newValue: `linked from ${ticket.ticketNumber}`,
    });

    revalidatePath("/dashboard/support/tickets");
    return {
      success: true,
      newTicketId: newTicket.id,
      newTicketNumber: newNumber,
      linkedFromClosed: true,
      message: null,
    };
  }

  // Pre-query email threading chain (only when this will be a public outbound reply)
  let threadMsgIds: string[] = [];
  if (validated.isPublic && ticket.contactId) {
    const rows = await db
      .select({ emailMessageId: ticketMessages.emailMessageId })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticketId), isNotNull(ticketMessages.emailMessageId)))
      .orderBy(ticketMessages.createdAt);
    threadMsgIds = rows.map((r) => r.emailMessageId as string);
  }

  const [message] = await db
    .insert(ticketMessages)
    .values({
      ticketId,
      senderId: session.user.id,
      content: validated.content,
      channel: validated.channel,
      isPublic: validated.isPublic,
      senderEmail: validated.senderEmail,
      senderName: validated.senderName,
      emailInReplyTo: threadMsgIds.at(-1) ?? null,
    })
    .returning();

  const ticketUpdates: Record<string, unknown> = { updatedAt: new Date() };
  if (!ticket.firstResponseAt) ticketUpdates.firstResponseAt = new Date();
  // Auto-move from 'new' to 'open' on first agent reply
  if (ticket.status === "new") ticketUpdates.status = "open";

  await db.update(tickets).set(ticketUpdates).where(eq(tickets.id, ticketId));

  await logTicketChange({
    ticketId,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    action: "message_added",
    newValue: validated.isPublic ? "public" : "internal_note",
  });

  // Send outbound email to customer for public replies (fire-and-forget)
  // Includes In-Reply-To + References for native email client thread grouping
  if (validated.isPublic && ticket.contactId) {
    after(async () => {
      const contact = await db.query.contacts.findFirst({
        where: eq(contacts.id, ticket.contactId!),
      });
      const customerEmail = contact?.email ?? null;
      if (!customerEmail) return;

      const result = await sendEmail({
        to: customerEmail,
        subject: `[${ticket.ticketNumber}] Re: ${ticket.subject}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <p style="color:#6b7280;font-size:12px;margin-bottom:16px">
              Reply to your support ticket <strong>${ticket.ticketNumber}</strong>
            </p>
            ${validated.content}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
            <p style="color:#9ca3af;font-size:11px">
              To reply, simply reply to this email and include the ticket number in the subject.
            </p>
          </div>
        `,
        inReplyTo: threadMsgIds.at(-1),
        references: threadMsgIds.length > 0 ? threadMsgIds.join(" ") : undefined,
      }).catch((err) => {
        console.error("[support] outbound email error:", err);
        return null;
      });

      // Store the provider's Message-ID for future replies to thread against
      if (result?.success && result.messageId) {
        await db
          .update(ticketMessages)
          .set({ emailMessageId: result.messageId })
          .where(eq(ticketMessages.id, message.id))
          .catch(console.error);
      }
    });
  }

  revalidatePath(`/dashboard/support/tickets/${ticketId}`);
  return { success: true, message };
}

export async function getTicketAuditLog(ticketId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return db.query.ticketAuditLogs.findMany({
    where: eq(ticketAuditLogs.ticketId, ticketId),
    orderBy: desc(ticketAuditLogs.createdAt),
    with: { actor: true },
  });
}

// --- SLA MANAGEMENT ---

export async function getSLAs() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return db.query.slas.findMany({
    where: eq(slas.isActive, true),
    orderBy: slas.priority,
  });
}

export async function createSLAAction(data: z.infer<typeof CreateSLASchema>) {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Only admins can create SLAs");

  const validated = CreateSLASchema.parse(data);
  const [sla] = await db.insert(slas).values(validated).returning();

  return { success: true, sla };
}

export async function updateSLAAction(slaId: string, data: z.infer<typeof UpdateSLASchema>) {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Only admins can update SLAs");

  const validated = UpdateSLASchema.parse(data);
  const [updated] = await db.update(slas).set(validated).where(eq(slas.id, slaId)).returning();

  return { success: true, sla: updated };
}

export async function deleteSLAAction(slaId: string) {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Only admins can delete SLAs");

  await db.delete(slas).where(eq(slas.id, slaId));

  return { success: true };
}

// --- CHAT CHANNELS ---

export async function getChatChannels() {
  return db.query.chatChannels.findMany({
    where: eq(chatChannels.isActive, true),
  });
}

export async function createChatChannelAction(name: string, type: string, config?: Record<string, unknown>) {
  const session = await auth();
  if (session?.user?.role !== "admin") throw new Error("Only admins can create chat channels");

  const [channel] = await db
    .insert(chatChannels)
    .values({ name, type, config: config ? JSON.stringify(config) : null })
    .returning();

  return { success: true, channel };
}

// --- CHAT SESSIONS ---

export async function startChatSessionAction(channelId: string, visitorEmail?: string, visitorName?: string) {
  const [chatSession] = await db
    .insert(chatSessions)
    .values({ channelId, visitorEmail, visitorName, status: "active" })
    .returning();

  return { success: true, session: chatSession };
}

export async function assignChatSessionAction(sessionId: string, agentId: string, ticketId?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const [updated] = await db
    .update(chatSessions)
    .set({ assignedAgentId: agentId, status: "assigned", ticketId })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  return { success: true, session: updated };
}

export async function endChatSessionAction(sessionId: string) {
  const [updated] = await db
    .update(chatSessions)
    .set({ status: "closed", endedAt: new Date() })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  return { success: true, session: updated };
}

// --- AGENTS ---

export async function getAgents() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return db.select({ id: users.id, name: users.name, email: users.email }).from(users);
}

// --- TICKET MUTATIONS ---

export async function deleteTicketAction(ticketId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
  if (!ticket) throw new Error("Ticket not found");

  if (session.user.id !== ticket.ownerId && session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }

  await db.delete(tickets).where(eq(tickets.id, ticketId));
  revalidatePath("/dashboard/support/tickets");
  return { success: true };
}

export async function reassignTicketAction(ticketId: string, assigneeId: string | null) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
  if (!ticket) throw new Error("Ticket not found");

  if (session.user.id !== ticket.ownerId && session.user.id !== ticket.assigneeId && session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }

  const [updated] = await db
    .update(tickets)
    .set({ assigneeId, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId))
    .returning();

  await logTicketChange({
    ticketId,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    action: "assigned",
    field: "assigneeId",
    oldValue: ticket.assigneeId ?? undefined,
    newValue: assigneeId ?? undefined,
  });

  revalidatePath(`/dashboard/support/tickets/${ticketId}`);
  return { success: true, ticket: updated };
}

const PRIORITY_ESCALATION: Record<string, string> = {
  low: "normal",
  normal: "high",
  high: "urgent",
  urgent: "urgent",
};

export async function escalateTicketAction(ticketId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
  if (!ticket) throw new Error("Ticket not found");

  if (session.user.id !== ticket.ownerId && session.user.id !== ticket.assigneeId && session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }

  const currentPriority = ticket.priority ?? "normal";
  const newPriority = PRIORITY_ESCALATION[currentPriority] ?? "urgent";

  if (newPriority === currentPriority) {
    return { success: true, ticket, alreadyMaxPriority: true };
  }

  const [updated] = await db
    .update(tickets)
    .set({ priority: newPriority, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId))
    .returning();

  await logTicketChange({
    ticketId,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    action: "priority_changed",
    field: "priority",
    oldValue: currentPriority,
    newValue: newPriority,
  });

  revalidatePath(`/dashboard/support/tickets/${ticketId}`);
  return { success: true, ticket: updated, previousPriority: currentPriority, newPriority };
}

export async function updateTicketStatusAction(ticketId: string, status: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, ticketId) });
  if (!ticket) throw new Error("Ticket not found");

  if (!canTransition(ticket.status, status)) {
    throw new Error(`Invalid transition: ${ticket.status} → ${status}`);
  }

  const now = new Date();
  const updateData: Record<string, unknown> = { status, updatedAt: now };

  if (status === "resolved") updateData.resolvedAt = now;
  if (status === "closed") updateData.closedAt = now;

  // SLA pause/resume
  if (isSLAPauseStatus(status) && !ticket.slaPausedAt) {
    updateData.slaPausedAt = now;
  } else if (!isSLAPauseStatus(status) && ticket.slaPausedAt) {
    const pausedMs = now.getTime() - ticket.slaPausedAt.getTime();
    updateData.slaPauseMinutes = (ticket.slaPauseMinutes ?? 0) + Math.floor(pausedMs / 60000);
    updateData.slaPausedAt = null;
  }

  const [updated] = await db.update(tickets).set(updateData).where(eq(tickets.id, ticketId)).returning();

  await logTicketChange({
    ticketId,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? undefined,
    action: "status_changed",
    field: "status",
    oldValue: ticket.status,
    newValue: status,
  });

  revalidatePath("/dashboard/support/tickets");
  revalidatePath(`/dashboard/support/tickets/${ticketId}`);
  return { success: true, ticket: updated };
}

// --- MACROS ---

export async function getMacros() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return db.query.ticketMacros.findMany({
    orderBy: ticketMacros.name,
    with: { creator: true },
  });
}

export async function createMacroAction(data: z.infer<typeof CreateMacroSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const validated = CreateMacroSchema.parse(data);
  const [macro] = await db
    .insert(ticketMacros)
    .values({ ...validated, createdBy: session.user.id })
    .returning();

  revalidatePath("/dashboard/settings/macros");
  return { success: true, macro };
}

export async function updateMacroAction(macroId: string, data: z.infer<typeof UpdateMacroSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const validated = UpdateMacroSchema.parse(data);
  const [updated] = await db
    .update(ticketMacros)
    .set({ ...validated, updatedAt: new Date() })
    .where(eq(ticketMacros.id, macroId))
    .returning();

  revalidatePath("/dashboard/settings/macros");
  return { success: true, macro: updated };
}

export async function deleteMacroAction(macroId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await db.delete(ticketMacros).where(eq(ticketMacros.id, macroId));

  revalidatePath("/dashboard/settings/macros");
  return { success: true };
}

// --- SELECT HELPERS ---

export async function getTicketsForSelect() {
  return db
    .select({ id: tickets.id, ticketNumber: tickets.ticketNumber, subject: tickets.subject })
    .from(tickets)
    .where(notInArray(tickets.status, ["closed", "resolved"]))
    .orderBy(desc(tickets.createdAt));
}

// --- CRON HELPERS ---

export async function autoCloseResolvedTickets() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const closed = await db
    .update(tickets)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(and(eq(tickets.status, "resolved"), lt(tickets.resolvedAt!, cutoff)))
    .returning({ id: tickets.id });

  return closed.length;
}

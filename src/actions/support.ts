"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import {
  tickets,
  ticketMessages,
  slas,
  chatChannels,
  chatSessions,
  users,
} from "@/db/schema";
import { eq, desc, and, lte, gte } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import {
  CreateTicketSchema,
  UpdateTicketSchema,
  AddMessageSchema,
  CreateSLASchema,
  UpdateSLASchema,
} from "@/actions/support-validation";

// --- HELPERS ---

function generateTicketNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TKT-${year}${month}-${random}`;
}

async function calculateSLATarget(slaId: string | null | undefined) {
  if (!slaId) return { firstResponseTarget: null, resolutionTarget: null };

  const sla = await db.query.slas.findFirst({
    where: eq(slas.id, slaId),
  });

  if (!sla) return { firstResponseTarget: null, resolutionTarget: null };

  const now = new Date();
  const firstResponseTarget = new Date(
    now.getTime() + sla.firstResponseTimeMinutes * 60000
  );
  const resolutionTarget = new Date(
    now.getTime() + sla.resolutionTimeMinutes * 60000
  );

  return { firstResponseTarget, resolutionTarget };
}

// --- MAIN ACTIONS ---

export async function createTicketAction(data: z.infer<typeof CreateTicketSchema>) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const validated = CreateTicketSchema.parse(data);
    const ticketNumber = generateTicketNumber();

    const [ticket] = await db
      .insert(tickets)
      .values({
        ticketNumber,
        subject: validated.subject,
        description: validated.description,
        channel: validated.channel,
        priority: validated.priority,
        severity: validated.severity,
        status: "open",
        contactId: validated.contactId,
        companyId: validated.companyId,
        ownerId: session.user.id,
        tags: validated.tags,
      })
      .returning();

    revalidatePath("/dashboard/support/tickets");
    revalidatePath("/dashboard/support");
    return { success: true, ticketId: ticket.id, ticketNumber };
  } catch (error) {
    console.error("[createTicketAction]", error);
    throw error;
  }
}

export async function getTicketById(ticketId: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.id, ticketId),
      with: {
        contact: true,
        company: true,
        assignee: true,
        owner: true,
        sla: true,
        messages: {
          orderBy: desc(ticketMessages.createdAt),
          with: {
            sender: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    // Check permission: owner, assigned agent, or admin
    const isAuthorized =
      session.user.id === ticket.ownerId ||
      session.user.id === ticket.assigneeId ||
      session.user.role === "admin";

    if (!isAuthorized) {
      throw new Error("Unauthorized");
    }

    return ticket;
  } catch (error) {
    console.error("[getTicketById]", error);
    throw error;
  }
}

export async function getTickets(options?: { limit?: number; status?: string }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const query = db.query.tickets.findMany({
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

    const ticketList = await query;
    return ticketList;
  } catch (error) {
    console.error("[getTickets]", error);
    throw error;
  }
}

export async function getTicketsByStatus(status: string) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

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
  } catch (error) {
    console.error("[getTicketsByStatus]", error);
    throw error;
  }
}

export async function updateTicketAction(
  ticketId: string,
  data: z.infer<typeof UpdateTicketSchema>
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const validated = UpdateTicketSchema.parse(data);
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.id, ticketId),
    });

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    // Check permission
    if (
      session.user.id !== ticket.ownerId &&
      session.user.id !== ticket.assigneeId &&
      session.user.role !== "admin"
    ) {
      throw new Error("Unauthorized");
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (validated.subject) updateData.subject = validated.subject;
    if (validated.description !== undefined) updateData.description = validated.description;
    if (validated.status) {
      updateData.status = validated.status;
      if (validated.status === "resolved") {
        updateData.resolvedAt = new Date();
      } else if (validated.status === "closed") {
        updateData.closedAt = new Date();
      }
    }
    if (validated.priority) updateData.priority = validated.priority;
    if (validated.severity) updateData.severity = validated.severity;
    if (validated.assigneeId !== undefined) {
      updateData.assigneeId = validated.assigneeId;
      if (validated.assigneeId && !ticket.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }
    }
    if (validated.tags) updateData.tags = validated.tags;

    const [updated] = await db
      .update(tickets)
      .set(updateData)
      .where(eq(tickets.id, ticketId))
      .returning();

    revalidatePath("/dashboard/support/tickets");
    revalidatePath(`/dashboard/support/tickets/${ticketId}`);
    return { success: true, ticket: updated };
  } catch (error) {
    console.error("[updateTicketAction]", error);
    throw error;
  }
}

export async function addTicketMessageAction(
  ticketId: string,
  data: z.infer<typeof AddMessageSchema>
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const validated = AddMessageSchema.parse(data);
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.id, ticketId),
    });

    if (!ticket) {
      throw new Error("Ticket not found");
    }

    // Check permission
    if (
      session.user.id !== ticket.ownerId &&
      session.user.id !== ticket.assigneeId &&
      session.user.role !== "admin"
    ) {
      throw new Error("Unauthorized");
    }

    // Add message
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
      })
      .returning();

    // Update ticket status if first response
    if (!ticket.firstResponseAt) {
      await db
        .update(tickets)
        .set({ firstResponseAt: new Date() })
        .where(eq(tickets.id, ticketId));
    }

    revalidatePath(`/dashboard/support/tickets/${ticketId}`);
    return { success: true, message };
  } catch (error) {
    console.error("[addTicketMessageAction]", error);
    throw error;
  }
}

// --- SLA MANAGEMENT ---

export async function getSLAs() {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Unauthorized");

    const slaList = await db.query.slas.findMany({
      where: eq(slas.isActive, true),
      orderBy: slas.priority,
    });

    return slaList;
  } catch (error) {
    console.error("[getSLAs]", error);
    throw error;
  }
}

export async function createSLAAction(data: z.infer<typeof CreateSLASchema>) {
  try {
    const session = await auth();
    if (session?.user?.role !== "admin") {
      throw new Error("Only admins can create SLAs");
    }

    const validated = CreateSLASchema.parse(data);
    const [sla] = await db.insert(slas).values(validated).returning();

    return { success: true, sla };
  } catch (error) {
    console.error("[createSLAAction]", error);
    throw error;
  }
}

// --- CHAT CHANNELS ---

export async function getChatChannels() {
  try {
    const channels = await db.query.chatChannels.findMany({
      where: eq(chatChannels.isActive, true),
    });

    return channels;
  } catch (error) {
    console.error("[getChatChannels]", error);
    throw error;
  }
}

export async function createChatChannelAction(
  name: string,
  type: string,
  config?: Record<string, unknown>
) {
  try {
    const session = await auth();
    if (session?.user?.role !== "admin") {
      throw new Error("Only admins can create chat channels");
    }

    const [channel] = await db
      .insert(chatChannels)
      .values({
        name,
        type,
        config: config ? JSON.stringify(config) : null,
      })
      .returning();

    return { success: true, channel };
  } catch (error) {
    console.error("[createChatChannelAction]", error);
    throw error;
  }
}

// --- CHAT SESSIONS ---

export async function startChatSessionAction(
  channelId: string,
  visitorEmail?: string,
  visitorName?: string
) {
  try {
    const [session] = await db
      .insert(chatSessions)
      .values({
        channelId,
        visitorEmail,
        visitorName,
        status: "active",
      })
      .returning();

    return { success: true, session };
  } catch (error) {
    console.error("[startChatSessionAction]", error);
    throw error;
  }
}

export async function assignChatSessionAction(
  sessionId: string,
  agentId: string,
  ticketId?: string
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const [updated] = await db
      .update(chatSessions)
      .set({
        assignedAgentId: agentId,
        status: "assigned",
        ticketId: ticketId,
      })
      .where(eq(chatSessions.id, sessionId))
      .returning();

    return { success: true, session: updated };
  } catch (error) {
    console.error("[assignChatSessionAction]", error);
    throw error;
  }
}

export async function endChatSessionAction(sessionId: string) {
  try {
    const [updated] = await db
      .update(chatSessions)
      .set({
        status: "closed",
        endedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId))
      .returning();

    return { success: true, session: updated };
  } catch (error) {
    console.error("[endChatSessionAction]", error);
    throw error;
  }
}

export async function updateSLAAction(slaId: string, data: z.infer<typeof UpdateSLASchema>) {
  try {
    const session = await auth();
    if (session?.user?.role !== "admin") {
      throw new Error("Only admins can update SLAs");
    }

    const validated = UpdateSLASchema.parse(data);
    const [updated] = await db
      .update(slas)
      .set(validated)
      .where(eq(slas.id, slaId))
      .returning();

    return { success: true, sla: updated };
  } catch (error) {
    console.error("[updateSLAAction]", error);
    throw error;
  }
}

export async function deleteSLAAction(slaId: string) {
  try {
    const session = await auth();
    if (session?.user?.role !== "admin") {
      throw new Error("Only admins can delete SLAs");
    }

    await db.delete(slas).where(eq(slas.id, slaId));

    return { success: true };
  } catch (error) {
    console.error("[deleteSLAAction]", error);
    throw error;
  }
}

// --- AGENTS ---

export async function getAgents() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users);
}

// --- TICKET MUTATIONS (with revalidation) ---

export async function deleteTicketAction(ticketId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });
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

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });
  if (!ticket) throw new Error("Ticket not found");

  if (
    session.user.id !== ticket.ownerId &&
    session.user.id !== ticket.assigneeId &&
    session.user.role !== "admin"
  ) {
    throw new Error("Unauthorized");
  }

  const [updated] = await db
    .update(tickets)
    .set({ assigneeId, updatedAt: new Date() })
    .where(eq(tickets.id, ticketId))
    .returning();

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

  const ticket = await db.query.tickets.findFirst({
    where: eq(tickets.id, ticketId),
  });
  if (!ticket) throw new Error("Ticket not found");

  if (
    session.user.id !== ticket.ownerId &&
    session.user.id !== ticket.assigneeId &&
    session.user.role !== "admin"
  ) {
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

  revalidatePath(`/dashboard/support/tickets/${ticketId}`);
  return { success: true, ticket: updated, previousPriority: currentPriority, newPriority };
}

export async function updateTicketStatusAction(ticketId: string, status: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "resolved") updateData.resolvedAt = new Date();
  if (status === "closed") updateData.closedAt = new Date();

  const [updated] = await db
    .update(tickets)
    .set(updateData)
    .where(eq(tickets.id, ticketId))
    .returning();

  revalidatePath("/dashboard/support/tickets");
  revalidatePath(`/dashboard/support/tickets/${ticketId}`);
  return { success: true, ticket: updated };
}

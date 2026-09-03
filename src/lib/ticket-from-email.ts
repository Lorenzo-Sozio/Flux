/**
 * Shared logic for creating/updating tickets from inbound emails.
 * Used by both the generic webhook (/api/webhooks/email-inbound)
 * and the Resend Inbound adapter (/api/webhooks/resend-inbound).
 */

import { after } from "next/server";

import crypto from "node:crypto";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { contacts, documents, ticketMessages, tickets } from "@/db/schema";
import {
  extractTicketReference,
  htmlToTextPreview,
  parseFromHeader,
  stripHtmlQuotesAndSignature,
  stripPlainTextQuotes,
} from "@/lib/email-parser";
import { getStorage, newStorageKey } from "@/lib/storage";
import { getDb } from "@/lib/tenant-context";

// ─── Attachment handling ──────────────────────────────────────────────────────

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — same as manual upload limit

/** MIME types accepted from inbound email attachments. Matches the upload route whitelist. */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

export interface InboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Persists a list of inbound attachments to disk and creates document records.
 * Returns the IDs of the saved documents.
 */
async function saveAttachments(attachments: InboundAttachment[], ticketId: string): Promise<string[]> {
  const db = await getDb();
  const docIds: string[] = [];

  for (const att of attachments) {
    const mime = att.contentType.split(";")[0].trim().toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mime)) continue;
    if (att.content.length === 0 || att.content.length > MAX_ATTACHMENT_BYTES) continue;

    // The extension comes from the MIME type, never from the sender's filename.
    const ext = MIME_TO_EXT[mime] ?? "";
    const storageKey = newStorageKey(`attachment${ext}`);

    try {
      // Object storage, not the disk: on Workers there is none, and on Vercel the
      // one that exists does not survive a deploy (audit rilievo B-06).
      const storage = await getStorage();
      await storage.put(storageKey, new Uint8Array(att.content), mime);
    } catch (err) {
      console.error("[ticket-from-email] could not store attachment:", err);
      continue;
    }

    try {
      const [doc] = await db
        .insert(documents)
        .values({
          name: sanitizeFilename(att.filename) || `attachment${ext}`,
          url: storageKey,
          mimeType: mime,
          size: att.content.length,
          entityType: "ticket",
          entityId: ticketId,
          // ownerId is null — system-created document from inbound email
        })
        .returning();
      docIds.push(doc.id);
    } catch (err) {
      console.error("[ticket-from-email] Failed to insert document record:", err);
    }
  }

  return docIds;
}

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim()
    .slice(0, 255);
}

// ─── Ticket processing ────────────────────────────────────────────────────────

function generateTicketNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TKT-${year}${month}-${random}`;
}

export interface InboundEmailPayload {
  fromRaw: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  inboundMessageId: string | null;
  inReplyTo: string | null;
  attachments?: InboundAttachment[];
}

export interface InboundEmailResult {
  ok: boolean;
  action?: "message_appended" | "ticket_created";
  ticketId?: string;
  messageId?: string;
  ticketNumber?: string;
  skipped?: string;
}

export async function processInboundEmail(payload: InboundEmailPayload): Promise<InboundEmailResult> {
  const db = await getDb();
  const { fromRaw, subject, htmlBody, textBody, inboundMessageId, inReplyTo, attachments = [] } = payload;

  if (!fromRaw || !subject) return { ok: false };

  const { name: senderName, email: senderEmail } = parseFromHeader(fromRaw);
  const ticketRef = extractTicketReference(subject);

  // Clean body: prefer HTML, fall back to plain text
  let messageContent: string;
  if (htmlBody) {
    messageContent = stripHtmlQuotesAndSignature(htmlBody);
  } else {
    const stripped = stripPlainTextQuotes(textBody);
    messageContent = `<p>${stripped.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  }

  if (!messageContent.trim() || messageContent === "<p></p>") {
    return { ok: true, skipped: "empty_body" };
  }

  // Find or create a stub contact for the sender
  let contactRecord = senderEmail
    ? await db.query.contacts.findFirst({ where: eq(contacts.email, senderEmail) })
    : null;

  if (!contactRecord && senderEmail) {
    const nameParts = (senderName ?? senderEmail.split("@")[0]).split(/\s+/);
    const [firstName, ...rest] = nameParts;
    const [newContact] = await db
      .insert(contacts)
      .values({
        firstName: firstName ?? senderEmail.split("@")[0],
        lastName: rest.join(" ") || "",
        email: senderEmail,
        source: "email_inbound",
        status: "active",
      })
      .returning();
    contactRecord = newContact;
  }

  // If a ticket reference is found in the subject, append message to that ticket
  if (ticketRef) {
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.ticketNumber, ticketRef),
    });

    if (ticket && ticket.status !== "closed") {
      const attachmentIds = await saveAttachments(attachments, ticket.id);

      const [message] = await db
        .insert(ticketMessages)
        .values({
          ticketId: ticket.id,
          content: messageContent,
          channel: "email",
          isPublic: true,
          senderEmail,
          senderName: senderName ?? senderEmail,
          senderId: contactRecord?.id ?? null,
          emailMessageId: inboundMessageId,
          emailInReplyTo: inReplyTo,
          attachmentIds,
        })
        .returning();

      // Auto-move from waiting → open when customer replies
      if (ticket.status === "waiting") {
        await db.update(tickets).set({ status: "open", updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
      } else {
        await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
      }

      after(() =>
        runAutomations({
          entityType: "ticket",
          entityId: ticket.id,
          event: "onUpdate",
          oldData: ticket as Record<string, unknown>,
          newData: {
            ...ticket,
            status: ticket.status === "waiting" ? "open" : ticket.status,
          } as Record<string, unknown>,
        }).catch(() => {
          /* best-effort */
        }),
      );

      return { ok: true, action: "message_appended", ticketId: ticket.id, messageId: message.id };
    }
    // Ticket closed or not found → fall through to create a new ticket
  }

  // Create a new ticket
  const ticketNumber = generateTicketNumber();
  const cleanSubject =
    subject
      .replace(/^\[TKT-[A-Z0-9-]+\]\s*/i, "")
      .replace(/^Re:\s*/i, "")
      .trim() || subject;

  const [newTicket] = await db
    .insert(tickets)
    .values({
      ticketNumber,
      subject: cleanSubject,
      description: htmlToTextPreview(messageContent, 500),
      channel: "email",
      priority: "normal",
      status: "new",
      contactId: contactRecord?.id ?? null,
      companyId: contactRecord?.companyId ?? null,
    })
    .returning();

  const attachmentIds = await saveAttachments(attachments, newTicket.id);

  await db.insert(ticketMessages).values({
    ticketId: newTicket.id,
    content: messageContent,
    channel: "email",
    isPublic: true,
    senderEmail,
    senderName: senderName ?? senderEmail,
    senderId: contactRecord?.id ?? null,
    emailMessageId: inboundMessageId,
    emailInReplyTo: inReplyTo,
    attachmentIds,
  });

  after(() =>
    runAutomations({
      entityType: "ticket",
      entityId: newTicket.id,
      event: "onCreate",
      oldData: {},
      newData: newTicket as Record<string, unknown>,
    }).catch(() => {
      /* best-effort */
    }),
  );

  return { ok: true, action: "ticket_created", ticketId: newTicket.id, ticketNumber };
}

/**
 * Inbound email webhook — receives emails forwarded by Resend (or any SMTP-to-webhook
 * provider that sends multipart/form-data or JSON) and creates/updates support tickets.
 *
 * Security: protected by INBOUND_EMAIL_SECRET environment variable.
 * Configure your email provider to POST to: https://your-domain.com/api/webhooks/email-inbound
 * with the header  X-Webhook-Secret: <INBOUND_EMAIL_SECRET>
 *
 * Expected JSON body (provider-agnostic normalized form):
 * {
 *   from:    "Name <email@example.com>",
 *   to:      "support@yourdomain.com",
 *   subject: "Re: [TKT-202401-ABCDEF] Issue title",
 *   html:    "<p>Reply body...</p>",
 *   text:    "Reply body...",
 *   messageId: "<unique-id@mail.example.com>",   // optional
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { tickets, ticketMessages, contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import {
  parseFromHeader,
  extractTicketReference,
  stripHtmlQuotesAndSignature,
  stripPlainTextQuotes,
  htmlToTextPreview,
} from "@/lib/email-parser";
import crypto from "crypto";

function generateTicketNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `TKT-${year}${month}-${random}`;
}

export async function POST(req: NextRequest) {
  // Auth check
  const secret = req.headers.get("x-webhook-secret");
  if (!process.env.INBOUND_EMAIL_SECRET || secret !== process.env.INBOUND_EMAIL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fromRaw: string = body.from ?? "";
  const subject: string = (body.subject ?? "").trim();
  const htmlBody: string = body.html ?? "";
  const textBody: string = body.text ?? "";
  const inboundMessageId: string | null = body.messageId ?? body.message_id ?? null;
  const inReplyTo: string | null = body.inReplyTo ?? body.in_reply_to ?? null;

  if (!fromRaw || !subject) {
    return NextResponse.json({ error: "Missing from or subject" }, { status: 400 });
  }

  const { name: senderName, email: senderEmail } = parseFromHeader(fromRaw);
  const ticketRef = extractTicketReference(subject);

  // Clean body: prefer HTML, fall back to plain text
  let messageContent: string;
  if (htmlBody) {
    messageContent = stripHtmlQuotesAndSignature(htmlBody);
  } else {
    const stripped = stripPlainTextQuotes(textBody);
    // Wrap plain text in minimal HTML for consistent rendering
    messageContent = `<p>${stripped.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  }

  if (!messageContent.trim() || messageContent === "<p></p>") {
    // Blank after stripping quotes — likely a blank reply forwarding header only
    return NextResponse.json({ ok: true, skipped: "empty_body" });
  }

  // Find or create a stub contact for the sender
  let contactRecord = senderEmail
    ? await db.query.contacts.findFirst({ where: eq(contacts.email, senderEmail) })
    : null;

  if (!contactRecord && senderEmail) {
    // Create minimal stub so the ticket is always linked to a contact
    const nameParts = (senderName ?? senderEmail.split("@")[0]).split(/\s+/);
    const [firstName, ...rest] = nameParts;
    const [newContact] = await db
      .insert(contacts)
      .values({
        firstName: firstName ?? senderEmail.split("@")[0],
        lastName:  rest.join(" ") || "",
        email:     senderEmail,
        source:    "email_inbound",
        status:    "active",
      })
      .returning();
    contactRecord = newContact;
  }

  // If a ticket reference is found, append message to that ticket
  if (ticketRef) {
    const ticket = await db.query.tickets.findFirst({
      where: eq(tickets.ticketNumber, ticketRef),
    });

    if (ticket && ticket.status !== "closed") {
      const [message] = await db
        .insert(ticketMessages)
        .values({
          ticketId:        ticket.id,
          content:         messageContent,
          channel:         "email",
          isPublic:        true,
          senderEmail,
          senderName:      senderName ?? senderEmail,
          senderId:        contactRecord?.id ?? null,
          emailMessageId:  inboundMessageId,
          emailInReplyTo:  inReplyTo,
        })
        .returning();

      // Auto-move from waiting → open when customer replies
      if (ticket.status === "waiting") {
        await db
          .update(tickets)
          .set({ status: "open", updatedAt: new Date() })
          .where(eq(tickets.id, ticket.id));
      } else {
        await db
          .update(tickets)
          .set({ updatedAt: new Date() })
          .where(eq(tickets.id, ticket.id));
      }

      after(() =>
        runAutomations({
          entityType: "ticket",
          entityId:   ticket.id,
          event:      "onUpdate",
          oldData:    ticket as Record<string, unknown>,
          newData:    { ...ticket, status: ticket.status === "waiting" ? "open" : ticket.status } as Record<string, unknown>,
        }).catch(() => {}),
      );

      return NextResponse.json({ ok: true, action: "message_appended", ticketId: ticket.id, messageId: message.id });
    }
    // Ticket closed or not found → fall through to create new ticket
  }

  // Create a new ticket
  const ticketNumber = generateTicketNumber();
  const cleanSubject = subject.replace(/^\[TKT-[A-Z0-9-]+\]\s*/i, "").replace(/^Re:\s*/i, "").trim() || subject;

  const [newTicket] = await db
    .insert(tickets)
    .values({
      ticketNumber,
      subject:     cleanSubject,
      description: htmlToTextPreview(messageContent, 500),
      channel:     "email",
      priority:    "normal",
      status:      "new",
      contactId:   contactRecord?.id ?? null,
      companyId:   contactRecord?.companyId ?? null,
    })
    .returning();

  // Add the email body as the first message
  await db.insert(ticketMessages).values({
    ticketId:       newTicket.id,
    content:        messageContent,
    channel:        "email",
    isPublic:       true,
    senderEmail,
    senderName:     senderName ?? senderEmail,
    senderId:       contactRecord?.id ?? null,
    emailMessageId: inboundMessageId,
    emailInReplyTo: inReplyTo,
  });

  after(() =>
    runAutomations({
      entityType: "ticket",
      entityId:   newTicket.id,
      event:      "onCreate",
      oldData:    {},
      newData:    newTicket as Record<string, unknown>,
    }).catch(() => {}),
  );

  return NextResponse.json({ ok: true, action: "ticket_created", ticketId: newTicket.id, ticketNumber });
}

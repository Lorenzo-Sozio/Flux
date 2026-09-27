/**
 * Shared logic for creating/updating tickets from inbound emails.
 * Used by both the generic webhook (/api/webhooks/email-inbound)
 * and the Resend Inbound adapter (/api/webhooks/resend-inbound).
 */

import { after } from "next/server";

import { eq } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { contacts, documents, emailSettings, ticketMessages, tickets } from "@/db/schema";
import {
  extractTicketReference,
  htmlToTextPreview,
  parseFromHeader,
  recipientAddresses,
  stripHtmlQuotesAndSignature,
  stripPlainTextQuotes,
} from "@/lib/email-parser";
import { fileSalesReply, findSalesOwner } from "@/lib/inbound-sales-reply";
import { archiveDomain, archiveOwner, fileArchivedEmail, findArchiveAlias } from "@/lib/mail-archive";
import { notify } from "@/lib/notify";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { stopOnReply } from "@/lib/sequence-runner";
import { getStorage, newStorageKey } from "@/lib/storage";
import { runWithTenant } from "@/lib/tenant-context";
import { resolveTenantByProbe, type TenantDb } from "@/lib/tenant-resolve";
import { ticketEventPayload } from "@/lib/ticket-events";
import { generateTicketNumber } from "@/lib/ticket-number";
import { resolveSla } from "@/lib/ticket-sla";
import { statusStamps } from "@/lib/ticket-state-machine";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import { membersWith } from "@/lib/workspace-members";

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
async function saveAttachments(db: TenantDb, attachments: InboundAttachment[], ticketId: string): Promise<string[]> {
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

export interface InboundEmailPayload {
  fromRaw: string;
  /**
   * The address it was sent to.
   *
   * Required, because it is how an email that mentions no ticket says which
   * workspace it belongs to — this runs on a webhook, where nothing else does.
   */
  to: string;
  /** The Cc header, when the bridge passes it: an archived email is filed on those too. */
  cc?: string;
  /**
   * Every address the message was delivered to — envelope recipients, `Delivered-To`.
   * A Bcc recipient is in no header, so this is the only place the archive address
   * (src/lib/mail-archive.ts) can be found.
   */
  recipients?: string[];
  subject: string;
  htmlBody: string;
  textBody: string;
  inboundMessageId: string | null;
  inReplyTo: string | null;
  attachments?: InboundAttachment[];
}

export interface InboundEmailResult {
  ok: boolean;
  action?: "message_appended" | "ticket_created" | "sales_reply" | "archived";
  /** For an archived email: on how many records it was filed. */
  filed?: number;
  ticketId?: string;
  /** For a sales reply: the timeline entry and the owner's task to answer it. */
  activityId?: string;
  taskId?: string;
  messageId?: string;
  ticketNumber?: string;
  skipped?: string;
}

/**
 * Which workspace an inbound email belongs to.
 *
 * Two questions, asked in order of certainty.
 *
 * A reply quotes the ticket reference in its subject, and a ticket number is
 * unique to the workspace that issued it — so that answer is exact.
 *
 * A first email has no reference. All it carries is the address it was sent to,
 * and the workspace that owns that address is the one configured to send from
 * it: a customer writing to support@theirfirm.example is writing to whoever
 * signs mail as support@theirfirm.example.
 *
 * ⚠️ When neither matches, this refuses. The tempting alternative — take the
 * first workspace, or the only one — files a stranger's email in somebody's CRM,
 * creates a contact record for them there, and looks like the feature working.
 */
async function resolveInboundTenant(
  ticketRef: string | null,
  to: string,
): Promise<{ db: TenantDb; tenantId: string } | null> {
  if (ticketRef) {
    const byTicket = await resolveTenantByProbe(`ticketNumber:${ticketRef}`, async (db) => {
      const row = await db.query.tickets.findFirst({
        where: eq(tickets.ticketNumber, ticketRef),
        columns: { id: true },
      });
      return Boolean(row);
    }).catch(() => null);
    if (byTicket) return { db: byTicket.db, tenantId: byTicket.tenant.id };
  }

  // `to` arrives as a header and may name several people: "Anna
  // <anna@firm.example>, Support <support@firm.example>". Each is tried in turn,
  // because a customer often writes to a person and copies the support address —
  // and it is the support address that identifies the workspace.
  for (const address of recipientAddresses(to)) {
    const byAddress = await resolveTenantByProbe(`inboundAddress:${address}`, async (db) => {
      const rows = await db.select({ fromEmail: emailSettings.fromEmail }).from(emailSettings);
      return rows.some((r) => r.fromEmail?.toLowerCase() === address);
    }).catch(() => null);
    if (byAddress) return { db: byAddress.db, tenantId: byAddress.tenant.id };
  }

  return null;
}

/**
 * An email somebody copied to their archive address: filed on the records it concerns,
 * and nothing else — it is not a ticket and not a reply owed (src/lib/mail-archive.ts).
 */
async function archiveInbound(
  alias: { subdomain: string; token: string },
  domain: string,
  payload: InboundEmailPayload,
): Promise<InboundEmailResult> {
  // The subdomain names the workspace; asking it costs nothing per tenant but a comparison.
  const found = await resolveTenantByProbe(
    `mailArchive:${alias.subdomain}`,
    async (_db, tenant) => tenant.subdomain === alias.subdomain,
  ).catch(() => null);
  // ⚠️ Not cached, so a rotated address stops filing at once. And the person must still be
  // somebody who may write here: an address outlives a membership, and a viewer is read-only.
  const ownerId = found ? await archiveOwner(found.db, alias.token).catch(() => null) : null;
  const mayWrite =
    found && ownerId
      ? (await membersWith(found.tenant.id, "record:write").catch(() => [] as string[])).includes(ownerId)
      : false;
  if (!found || !ownerId || !mayWrite) {
    console.error(`[inbound-email] archive address not recognised: workspace=${alias.subdomain}`);
    return { ok: false, skipped: "unknown_archive_address" };
  }

  const text = payload.htmlBody
    ? htmlToTextPreview(stripHtmlQuotesAndSignature(payload.htmlBody), 5000)
    : stripPlainTextQuotes(payload.textBody);
  const result = await fileArchivedEmail(
    found.db,
    ownerId,
    {
      from: payload.fromRaw,
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      text,
      messageId: payload.inboundMessageId,
    },
    domain,
  );

  // ⚠️ Nobody among the addresses is a contact or a lead: say so, or the person believes it
  // was archived. The bell only — it is not urgent, and it is not a push type.
  if (result.matched === 0) {
    await runWithTenant(found.tenant.id, () =>
      notify({
        userId: ownerId,
        type: "mail_archive",
        key: "mailArchiveUnmatched",
        params: { subject: payload.subject },
      }),
    ).catch((err) => console.error("[inbound-email] archive unmatched, owner not told:", err));
  }
  return { ok: true, action: "archived", filed: result.filed };
}

export async function processInboundEmail(payload: InboundEmailPayload): Promise<InboundEmailResult> {
  const { fromRaw, to, subject, htmlBody, textBody, inboundMessageId, inReplyTo, attachments = [] } = payload;

  if (!fromRaw || !subject) return { ok: false };

  // ⚠️ First: an email carrying an archive address was sent to be kept, not answered. It
  // names no workspace address, so the resolution below would refuse it anyway.
  const domain = archiveDomain();
  const alias = findArchiveAlias([to, payload.cc ?? "", ...(payload.recipients ?? [])], domain);
  if (alias && domain) return archiveInbound(alias, domain, payload);

  const { name: senderName, email: senderEmail } = parseFromHeader(fromRaw);
  const ticketRef = extractTicketReference(subject);

  // ⚠️⚠️ This runs on a webhook. `getDb()` reads the x-tenant-id header the proxy
  // injects only for authenticated dashboard requests and throws when it is
  // absent — which is every call that ever reached here, so **no inbound email
  // has ever been recorded**: both routes answered 500 and the mail bridge
  // dropped or retried the message for ever (audit rilievo B-01, in two entry
  // points its fix did not reach).
  //
  // Outside the dashboard the workspace comes from the data. A reply carries the
  // ticket reference in its subject, which names it exactly; a first email
  // carries only the address it was sent to, which is the address that workspace
  // sends from.
  const resolved = await resolveInboundTenant(ticketRef, to);
  if (!resolved) {
    // ⚠️ Loudly. The bridge is answered 200 on purpose — retrying will not make
    // the workspace recognisable — so this line is the only trace the message
    // ever existed. The usual cause is a workspace that has not set its sending
    // address, which is the address its customers reply to.
    console.error(
      `[inbound-email] no workspace matches. to=${JSON.stringify(to)} ticketRef=${ticketRef ?? "none"}. ` +
        "Set the workspace's from address under Settings → Email, or make sure the subject keeps its [TKT-…] reference.",
    );
    return { ok: false, skipped: "unknown_workspace" };
  }
  const { db, tenantId } = resolved;

  // ⚠️ Before anything that can return early: an empty or quoted-only reply is
  // still an answer, and the automatic emails must stop for it. Never allowed to
  // fail the delivery of the message itself.
  let sequencesStopped = 0;
  if (senderEmail) {
    sequencesStopped = await runWithTenant(tenantId, () =>
      tolerateUnmigrated("sequences", () => stopOnReply(db, senderEmail), 0),
    ).catch((err) => {
      console.error("[inbound-email] could not stop sequences on reply:", err);
      return 0;
    });
  }

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

  // ⚠️⚠️ Somebody a salesperson owns, writing about something that is not a ticket: theirs,
  // not support's (src/lib/inbound-sales-reply.ts). A reply to a ticket stays on the ticket.
  if (!ticketRef && senderEmail) {
    const owner = await findSalesOwner(db, senderEmail);
    if (owner) {
      const filed = await fileSalesReply(db, owner, {
        from: senderEmail,
        to,
        subject,
        text: htmlToTextPreview(messageContent, 5000),
      });
      // Stopping a sequence already told the owner who answered; once is enough.
      if (sequencesStopped === 0) {
        await runWithTenant(tenantId, () =>
          notify({
            userId: owner.ownerId,
            type: "email_reply",
            key: "emailReply",
            params: { who: owner.name, subject },
            link: owner.contactId ? `/dashboard/contacts/${owner.contactId}` : `/dashboard/leads/${owner.leadId}`,
          }),
        ).catch((err) => console.error("[inbound-email] reply filed, owner not notified:", err));
      }
      return { ok: true, action: "sales_reply", activityId: filed.activityId, taskId: filed.taskId };
    }
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
      const attachmentIds = await saveAttachments(db, attachments, ticket.id);

      const [message] = await db
        .insert(ticketMessages)
        .values({
          ticketId: ticket.id,
          content: messageContent,
          channel: "email",
          isPublic: true,
          senderEmail,
          senderName: senderName ?? senderEmail,
          // ⚠️⚠️ Null, and never the contact. `senderId` references `user` — one of
          // *our* people — and the database enforces it, so writing a contact id
          // here raises a foreign key violation and the customer's email is not
          // recorded at all. Who sent it is carried by senderEmail and senderName,
          // which is what those columns are for; which customer it belongs to is
          // on the ticket. It also decides "whose move is it" on the handover
          // panel: a message with a senderId is read as an answer from us.
          senderId: null,
          emailMessageId: inboundMessageId,
          emailInReplyTo: inReplyTo,
          attachmentIds,
        })
        .returning();

      // The customer answering moves the ticket back to us: from "waiting on them", and from
      // "resolved" — the resolution email says a reply reopens it, so a reply must. Through
      // the shared rule, which also ends the SLA pause the plain status write used to leave on.
      const now = new Date();
      const reopen =
        ticket.status === "waiting" || ticket.status === "resolved" ? statusStamps(ticket, "open", now) : null;
      await db
        .update(tickets)
        .set({ ...(reopen ?? {}), updatedAt: now })
        .where(eq(tickets.id, ticket.id));

      // ⚠️ Inside `runWithTenant`. The rules read the database through `getDb()`, which
      // on a webhook has no workspace to start from: without this they all failed, in
      // silence, because they run after the response and the error is swallowed. A desk
      // with a rule saying "when a ticket arrives, tell the support group" received
      // nothing for tickets born from email, and had no way of noticing.
      after(() =>
        runWithTenant(tenantId, () =>
          runAutomations({
            entityType: "ticket",
            entityId: ticket.id,
            event: "onUpdate",
            oldData: ticket as Record<string, unknown>,
            newData: { ...ticket, ...(reopen ?? {}) } as Record<string, unknown>,
          }),
        ).catch(() => {
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

  // An emailed request carries the same promise as a typed one (src/lib/ticket-sla.ts).
  const sla = await resolveSla(db, "normal");
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
      slaId: sla.slaId,
      firstResponseDueAt: sla.firstResponseDueAt,
      slaDeadlineAt: sla.slaDeadlineAt,
    })
    .returning();

  const attachmentIds = await saveAttachments(db, attachments, newTicket.id);

  // The customer wrote it: `user`, with no actor, as a quote accepted from its page.
  dispatchWebhook("ticket.created", ticketEventPayload(newTicket), { via: "user", actor: null }, db).catch((err) =>
    console.error("[inbound] ticket.created not dispatched", err),
  );

  await db.insert(ticketMessages).values({
    ticketId: newTicket.id,
    content: messageContent,
    channel: "email",
    isPublic: true,
    senderEmail,
    senderName: senderName ?? senderEmail,
    // See the note above: this column means one of our staff, and the database
    // enforces it. The sender is identified by senderEmail and senderName.
    senderId: null,
    emailMessageId: inboundMessageId,
    emailInReplyTo: inReplyTo,
    attachmentIds,
  });

  // As above: the rules need the workspace, and there is no header here to give it.
  after(() =>
    runWithTenant(tenantId, () =>
      runAutomations({
        entityType: "ticket",
        entityId: newTicket.id,
        event: "onCreate",
        oldData: {},
        newData: newTicket as Record<string, unknown>,
      }),
    ).catch(() => {
      /* best-effort */
    }),
  );

  return { ok: true, action: "ticket_created", ticketId: newTicket.id, ticketNumber };
}

"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { activities, users } from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";
import { sendEmail } from "@/lib/email-provider";
import { inboundEmailConfigured, replyToFor } from "@/lib/inbound-sales-reply";
import { sendFromOwnMailbox } from "@/lib/mailbox-send";
import { getDb } from "@/lib/tenant-context";

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sendEmailAction({
  to,
  subject,
  body,
  leadId,
  contactId,
  ownerId,
}: {
  to: string;
  subject: string;
  body: string;
  leadId?: string;
  contactId?: string;
  ownerId?: string;
}) {
  const actor = await requireWriteAccess();
  const db = await getDb();
  const [me] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, actor.user.id));

  // From the person's own mailbox when they connected one (V3.2): it goes out as them, and
  // the answer comes back where the sync reads it. Otherwise the workspace's sender.
  const own = await sendFromOwnMailbox(db, actor.user.id, { to: [to], subject, html: body, fromName: me?.name });
  if (own.used && !own.ok) {
    throw new Error(`Your mailbox did not send it: ${own.error}`);
  }
  const messageId: string | null = own.used ? own.messageId : null;
  if (!own.used) {
    const replyTo = replyToFor(inboundEmailConfigured(), me?.email);
    const result = await sendEmail({ to, subject, html: body, ...(replyTo ? { replyTo } : {}) });
    if (!result.success) {
      throw new Error(result.error ?? "Failed to send email.");
    }
  }

  // ⚠️ From here on the email has gone. Recording it is worth doing and not worth failing
  // over: an error now would tell the person the send failed, and the obvious next move —
  // sending again — delivers it twice.
  const bodyText = stripHtml(body);
  await db
    .insert(activities)
    .values({
      type: "email",
      content: JSON.stringify({
        _type: "email_v2",
        direction: "out",
        ...(own.used ? { from: own.from } : {}),
        subject,
        to,
        snippet: bodyText.substring(0, 300),
        bodyText: bodyText.substring(0, 5000),
      }),
      leadId,
      contactId,
      ownerId,
      date: new Date(),
      // The copy the mailbox sync reads back from Sent is the same message: this id makes it
      // one entry on the timeline, not two.
      messageId,
    })
    .catch((err) => {
      console.error("[sendEmailAction] sent, but not logged on the record:", err);
    });

  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  if (contactId) revalidatePath(`/dashboard/contacts/${contactId}`);

  return { success: true };
}

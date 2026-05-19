"use server";

import { revalidatePath } from "next/cache";

import { activities } from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";
import { sendEmail } from "@/lib/email-provider";
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
  await requireWriteAccess();
  const db = await getDb();
  const result = await sendEmail({ to, subject, html: body });

  if (!result.success) {
    throw new Error(result.error ?? "Failed to send email.");
  }

  const bodyText = stripHtml(body);
  await db.insert(activities).values({
    type: "email",
    content: JSON.stringify({
      _type: "email_v2",
      subject,
      to,
      snippet: bodyText.substring(0, 300),
      bodyText: bodyText.substring(0, 5000),
    }),
    leadId,
    contactId,
    ownerId,
    date: new Date(),
  });

  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  if (contactId) revalidatePath(`/dashboard/contacts/${contactId}`);

  return { success: true };
}

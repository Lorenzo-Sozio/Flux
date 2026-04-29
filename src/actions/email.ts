"use server";

import { db } from "@/db";
import { activities } from "@/db/schema";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/email-provider";

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
  const result = await sendEmail({ to, subject, html: body });

  if (!result.success) {
    throw new Error(result.error ?? "Failed to send email.");
  }

  await db.insert(activities).values({
    type: "email",
    content: `Sent Email: ${subject}\n\n${body.substring(0, 200)}${body.length > 200 ? "..." : ""}`,
    leadId,
    contactId,
    ownerId,
    date: new Date(),
  });

  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  if (contactId) revalidatePath(`/dashboard/contacts/${contactId}`);

  return { success: true };
}

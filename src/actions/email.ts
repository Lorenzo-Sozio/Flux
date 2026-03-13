"use server";

import { db } from "@/db";
import { activities } from "@/db/schema";
import { revalidatePath } from "next/cache";

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
  // SIMULATION: In a real app, integrate with Resend, SendGrid, or AWS SES here
  console.log(`Sending email to ${to}...`);
  console.log(`Subject: ${subject}`);
  console.log(`Body: ${body}`);

  // Log as activity
  await db.insert(activities).values({
    type: "email",
    content: `Sent Email: ${subject}\n\n${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`,
    leadId,
    contactId,
    ownerId,
    date: new Date(),
  });

  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  if (contactId) revalidatePath(`/dashboard/contacts/${contactId}`);

  return { success: true };
}

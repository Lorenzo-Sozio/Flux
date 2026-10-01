"use server";

import { revalidatePath } from "next/cache";

import { requireWriteAccess } from "@/lib/auth-guard";
import { composeEmail, deliverEmail, type EmailPreview, type SendEmailResult } from "@/lib/email-deliver";
import { getDb } from "@/lib/tenant-context";

export type { EmailPreview, SendEmailResult };

/**
 * An email a person wrote from a record — a contact, a lead, a company, a deal. The sending
 * itself is `deliverEmail` (src/lib/email-deliver.ts), the path every email from the CRM takes.
 */
export async function sendEmailAction({
  to,
  cc,
  bcc,
  subject,
  body,
  leadId,
  contactId,
  companyId,
  dealId,
  ownerId,
  templateId,
  signature,
}: {
  to: string;
  /** Copies, as typed: comma, semicolon or space separated (src/lib/email-addresses.ts). */
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  leadId?: string;
  contactId?: string;
  /** Written to a company's own address: logged on the company. */
  companyId?: string;
  /** Sent from a deal's page: logged on the deal as well as on its contact. */
  dealId?: string;
  ownerId?: string;
  /** The template the email started from: counted, so the ones in use come first. */
  templateId?: string;
  /** False when the person took the signature off this one email. */
  signature?: boolean;
}): Promise<SendEmailResult> {
  const actor = await requireWriteAccess();
  const db = await getDb();
  const result = await deliverEmail(
    db,
    { userId: actor.user.id },
    {
      to,
      cc,
      bcc,
      subject,
      html: body,
      sender: "person",
      signature: signature === false ? "none" : "full",
      dealId,
      log: { leadId, contactId, companyId, dealId, ownerId },
      templateId,
    },
  );
  if (!result.success) return result;

  if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);
  if (contactId) revalidatePath(`/dashboard/contacts/${contactId}`);
  if (companyId) revalidatePath(`/dashboard/companies/${companyId}`);
  if (dealId) revalidatePath(`/dashboard/pipeline/${dealId}`);
  return { success: true };
}

/**
 * What the customer will receive from `sendEmailAction`, without sending it: the dialog has filled
 * the recipient's fields, this fills the sender's and the deal's the way the send does.
 */
export async function previewEmailAction({
  subject,
  body,
  dealId,
  signature,
}: {
  subject: string;
  body: string;
  dealId?: string;
  signature?: boolean;
}): Promise<EmailPreview> {
  const actor = await requireWriteAccess();
  const email = await composeEmail(
    await getDb(),
    { userId: actor.user.id },
    { subject, html: body, dealId, signature: signature === false ? "none" : "full" },
  );
  return { ok: true, subject: email.subject, html: email.html };
}

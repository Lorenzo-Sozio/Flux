/**
 * Sending an email a person wrote, from anywhere in the CRM: a record's dialog, a quote, an
 * invoice's copy, a payment reminder. One path, so every one of them fills the same fields,
 * accepts the same copies, goes out the same way and lands on the same timeline.
 *
 * ⚠️ Returns its failures, never throws them: a thrown message never reaches the screen in
 * production, and "the email did not go, and why" is what the person needs to read.
 */
import { eq } from "drizzle-orm";

import { activities, companies, deals, users } from "@/db/schema";
import { documentLanguage, formatDocumentMoney } from "@/lib/document-language";
import { MAX_COPIES, parseAddressList } from "@/lib/email-addresses";
import {
  type BrandLang,
  type EmailKit,
  personalEmail,
  placesSignature,
  type SignatureVariant,
  signatureHtml,
  signaturePerson,
} from "@/lib/email-brand";
import { brandValues, loadEmailBrand } from "@/lib/email-brand-load";
import { dealValues, type PlaceholderValues, renderPlaceholders, senderValues } from "@/lib/email-placeholders";
import { type EmailAttachment, sendEmail } from "@/lib/email-provider";
import { recordTemplateUse } from "@/lib/email-templates";
import { serverT } from "@/lib/i18n-server";
import { inboundEmailConfigured, replyToFor } from "@/lib/inbound-sales-reply";
import { loadConnection } from "@/lib/mail-connection";
import { sendFromOwnMailbox } from "@/lib/mailbox-send";
import { sellerIdentity } from "@/lib/seller-identity";
import { readSignatureSettings } from "@/lib/workspace-preferences";

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

export type SendEmailResult = { success: true } | { success: false; error: string };

/** What the dialog's preview shows: the subject and the body exactly as they will leave. */
export type EmailPreview = { ok: true; subject: string; html: string } | { ok: false; error: string };

export interface DeliverEmail {
  to: string;
  /** Copies, as typed: comma, semicolon or space separated (src/lib/email-addresses.ts). */
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  /**
   * - `person`: from the person's own mailbox when connected, otherwise the workspace's sender;
   * - `workspace`: always the workspace's sender — a document from the business (an invoice)
   *   goes out from the business, and it may carry attachments a mailbox connection cannot.
   */
  sender: "person" | "workspace";
  /** For `workspace`: where the customer's answer goes (the issuer's address on an invoice). */
  replyTo?: string | null;
  attachments?: EmailAttachment[];
  /** Sent from a deal: fills `{{trattativa}}` and `{{valore}}`. */
  dealId?: string;
  /** Where the email is recorded on the timeline. */
  log: {
    leadId?: string | null;
    contactId?: string | null;
    companyId?: string | null;
    dealId?: string | null;
    ownerId?: string | null;
    /** The document it was about, shown on the timeline beside it. */
    document?: { type: "quote" | "invoice"; id: string; number?: string | null };
  };
  templateId?: string;
  /**
   * What a document makes of the person's text once the fields are filled: the frame with the
   * workspace's logo, the document's figures, its button — and where the signature goes.
   * Without it the email is personal: the text, then the signature.
   */
  finish?: (html: string, kit: EmailKit) => string;
  /**
   * The sender's signature (src/lib/email-brand.ts), from their Profile — added whether the email
   * leaves from the workspace or from their own mailbox. Nothing when they switched it off.
   */
  signature?: SignatureVariant | "none";
  /** The customer's language, for the frame's and the signature's fixed words. */
  lang?: BrandLang;
}

export type { EmailKit };

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

/** The values of the sender's fields, and of the deal's when there is one. */
export async function ownFields(
  db: AnyDb,
  me: { name: string | null; email: string | null } | undefined,
  dealId: string | undefined,
  companyName?: string,
): Promise<PlaceholderValues> {
  const company = companyName ?? (await sellerIdentity(db).catch(() => ({ name: "" }))).name;
  const values: PlaceholderValues = senderValues({ name: me?.name, email: me?.email, company });
  if (!dealId) return values;
  const [row] = await db
    .select({
      name: deals.name,
      amount: deals.amount,
      amountOriginal: deals.amountOriginal,
      currency: deals.currency,
      company: companies,
    })
    .from(deals)
    .leftJoin(companies, eq(deals.companyId, companies.id))
    .where(eq(deals.id, dealId));
  if (!row) return values;
  // In the deal's own currency and in the customer's language, as on its documents.
  const value = row.amountOriginal
    ? formatDocumentMoney(row.amountOriginal, row.currency ?? "EUR", documentLanguage(row.company))
    : formatDocumentMoney(row.amount, "EUR", documentLanguage(row.company));
  return { ...values, ...dealValues({ name: row.name, value }) };
}

/**
 * The email as it will leave: the sender's and the deal's fields filled, and what the document adds
 * below the text. The send and the dialog's preview both call it, so the preview is not a guess.
 */
export async function composeEmail(
  db: AnyDb,
  actor: { userId: string },
  input: Pick<DeliverEmail, "subject" | "html" | "dealId" | "finish" | "signature" | "lang">,
): Promise<{ me: { name: string | null; email: string | null } | undefined; subject: string; html: string }> {
  const [[me], brand] = await Promise.all([
    db
      .select({ email: users.email, name: users.name, image: users.image })
      .from(users)
      .where(eq(users.id, actor.userId)) as Promise<
      { email: string | null; name: string | null; image: string | null }[]
    >,
    loadEmailBrand(db),
  ]);
  const lang = input.lang ?? "it";

  let signature = "";
  if (me && input.signature && input.signature !== "none") {
    const settings = await readSignatureSettings(db, actor.userId);
    if (settings.enabled) {
      signature = signatureHtml({ person: signaturePerson(me, settings), brand, variant: input.signature, lang });
    }
  }

  // The sender's fields — and the deal's, from a deal — are filled in here, where who sends and
  // from where are known; the dialog has already filled in the recipient's. A template that
  // places `{{firma}}` itself gets it there, and not a second time at the end.
  const placed = placesSignature(input.html);
  const fill = { ...(await ownFields(db, me, input.dealId, brand.name)), ...brandValues(brand, signature) };
  const subject = renderPlaceholders(input.subject, fill);
  const filled = renderPlaceholders(input.html, fill);
  const end = placed ? "" : signature;
  const html = input.finish ? input.finish(filled, { brand, signature: end, lang }) : personalEmail(filled, end);
  return { me: me ? { name: me.name, email: me.email } : undefined, subject, html };
}

export async function deliverEmail(
  db: AnyDb,
  actor: { userId: string },
  input: DeliverEmail,
): Promise<SendEmailResult> {
  const t = await serverT("marketing.sendEmailModal");

  // The same rule the dialog applies before sending: the browser is not where a rule is kept.
  const copies = parseAddressList(input.cc);
  const hidden = parseAddressList(input.bcc);
  const wrong = [...copies.invalid, ...hidden.invalid];
  if (wrong.length > 0) return { success: false, error: t("invalidCopies", { list: wrong.join(", ") }) };
  if (copies.addresses.length + hidden.addresses.length > MAX_COPIES) {
    return { success: false, error: t("tooManyCopies", { max: MAX_COPIES }) };
  }
  const to = parseAddressList(input.to);
  if (to.addresses.length !== 1 || to.invalid.length > 0) {
    return { success: false, error: t("invalidCopies", { list: input.to }) };
  }

  const { me, subject, html } = await composeEmail(db, actor, input);

  let own: Awaited<ReturnType<typeof sendFromOwnMailbox>> = { used: false };
  if (input.sender === "person") {
    // ⚠️ A connected mailbox sends Cc but not Bcc (mailbox-send.ts). Sending from the workspace
    // instead would switch the sender silently — the one thing a connected mailbox promises not to do.
    if (hidden.addresses.length > 0 && (await loadConnection(db, actor.userId))?.status === "active") {
      return { success: false, error: t("bccNotFromMailbox") };
    }
    // From the person's own mailbox when they connected one (V3.2): it goes out as them, and
    // the answer comes back where the sync reads it. Otherwise the workspace's sender.
    own = await sendFromOwnMailbox(db, actor.userId, {
      to: [to.addresses[0]],
      ...(copies.addresses.length ? { cc: copies.addresses } : {}),
      subject,
      html,
      fromName: me?.name,
    });
    if (own.used && !own.ok) return { success: false, error: t("mailboxFailed", { error: own.error }) };
  }
  const messageId: string | null = own.used && own.ok ? own.messageId : null;
  if (!own.used) {
    const replyTo = input.sender === "workspace" ? input.replyTo : replyToFor(inboundEmailConfigured(), me?.email);
    const result = await sendEmail({
      to: to.addresses[0],
      subject,
      html,
      ...(copies.addresses.length ? { cc: copies.addresses.join(", ") } : {}),
      ...(hidden.addresses.length ? { bcc: hidden.addresses.join(", ") } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
    if (!result.success) {
      return { success: false, error: result.error ? t("providerFailed", { error: result.error }) : t("sendFailed") };
    }
  }

  // ⚠️ From here on the email has gone. Recording it is worth doing and not worth failing over:
  // an error now would tell the person the send failed, and the obvious next move — sending
  // again — delivers it twice.
  const bodyText = stripHtml(html);
  const { log } = input;
  await db
    .insert(activities)
    .values({
      type: "email",
      content: JSON.stringify({
        _type: "email_v2",
        direction: "out",
        ...(own.used && own.ok ? { from: own.from } : {}),
        subject,
        to: to.addresses[0],
        ...(copies.addresses.length ? { cc: copies.addresses } : {}),
        ...(hidden.addresses.length ? { bcc: hidden.addresses } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments.map((a) => a.filename) } : {}),
        ...(log.document ? { document: log.document } : {}),
        snippet: bodyText.substring(0, 300),
        bodyText: bodyText.substring(0, 5000),
      }),
      leadId: log.leadId ?? undefined,
      contactId: log.contactId ?? undefined,
      companyId: log.companyId ?? undefined,
      dealId: log.dealId ?? undefined,
      ownerId: log.ownerId ?? actor.userId,
      date: new Date(),
      // The copy the mailbox sync reads back from Sent is the same message: this id makes it
      // one entry on the timeline, not two.
      messageId,
    })
    .catch((err: unknown) => {
      console.error("[deliverEmail] sent, but not logged on the record:", err);
    });

  if (input.templateId) {
    await recordTemplateUse(db, input.templateId).catch((err: unknown) => {
      console.error("[deliverEmail] sent, but the template's use was not counted:", err);
    });
  }
  return { success: true };
}

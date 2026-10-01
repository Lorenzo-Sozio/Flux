"use server";

import { revalidatePath } from "next/cache";

import crypto from "node:crypto";

import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";

import { CreateQuoteSchema, UpdateQuoteSchema } from "@/actions/quotes-validation";
import { companies, contacts, deals, products, quoteActivities, quoteItems, quotes } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { ForbiddenError, requireCapability, requirePlanModule } from "@/lib/auth-guard";
import {
  type DocumentLanguage,
  documentLanguage,
  fill,
  formatDocumentDate,
  formatDocumentMoney,
  QUOTE_TEXT,
} from "@/lib/document-language";
import { computeDocument } from "@/lib/document-totals";
import { brandFrame, ctaButton, esc, summaryBox } from "@/lib/email-brand";
import { composeEmail, deliverEmail, type EmailKit, type EmailPreview } from "@/lib/email-deliver";
import { getExchangeRates } from "@/lib/exchange-rates";
import { getTenantById } from "@/lib/get-tenant";
import { serverT } from "@/lib/i18n-server";
import { notify, notifyMany } from "@/lib/notify";
import { type ListParams, offsetOf, toPage } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { announceQuoteDecision, announceQuoteSent, hasAlreadyLeft } from "@/lib/quote-events";
import { generateQuoteNumber } from "@/lib/quote-number";
import {
  approvalRequiredReason,
  canTransition,
  decideQuoteSend,
  revisionNumber,
  transitionError,
} from "@/lib/quote-status";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { USER_SUMMARY_COLUMNS } from "@/lib/user-columns";
import { membersWith } from "@/lib/workspace-members";
import { defaultExpiry, readApprovalPolicy, readQuoteDefaults } from "@/lib/workspace-preferences";

// --- HELPERS ---

/**
 * Builds the rows and the document totals for a quote.
 *
 * The old code returned a tax-INCLUSIVE line total, summed those into a field
 * called `subtotal`, then applied the header discount and the header tax on top —
 * charging tax on tax and printing a "subtotal" that was nothing of the sort
 * (audit rilievo C-01). The arithmetic now lives in one tested module shared with
 * orders, so creation and update cannot drift apart either (rilievo C-03).
 */
function buildQuoteTotals(
  items: { quantity: number; unitPrice: number; discountPercent?: number; taxPercent?: number }[],
  discountPercent: number,
  headerTaxPercent: number | undefined,
) {
  return computeDocument({
    lines: items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPercent: i.discountPercent ?? 0,
      // A header rate, when given, overrides the per-line rates; otherwise each
      // line keeps its own, which is what a mixed-rate document needs.
      taxPercent: i.taxPercent ?? 0,
    })),
    discountPercent,
    taxPercent: headerTaxPercent && headerTaxPercent > 0 ? headerTaxPercent : undefined,
  });
}

async function logQuoteActivity(
  quoteId: string,
  type: string,
  userId?: string,
  email?: string,
  ipAddress?: string,
  userAgent?: string,
) {
  const db = await getDb();
  await db.insert(quoteActivities).values({
    quoteId,
    type,
    userId,
    email,
    ipAddress,
    userAgent,
  });
}

// --- MAIN ACTIONS ---

export async function createQuoteAction(data: z.infer<typeof CreateQuoteSchema>) {
  const db = await getDb();
  try {
    const actor = await requireCapability("quote:write");
    await requirePlanModule("sales");
    const validated = CreateQuoteSchema.parse(data);

    // Verify deal exists
    const dealExists = await db.query.deals.findFirst({
      where: eq(deals.id, validated.dealId),
    });

    if (!dealExists) {
      throw new Error("Deal not found");
    }

    // The document keeps the currency it was written in.
    //
    // Everything used to be converted to EUR and the currency column hardcoded to
    // "EUR", so an offer made in dollars reached the customer as a euro figure at
    // the day's rate, with the original amount unrecoverable (audit rilievo C-02).
    // The rate is stored alongside, for reporting, and captured now so a later rate
    // change cannot rewrite a document that has already been sent.
    const currency = (validated.currency || "EUR").toUpperCase();
    let eurRate = 1; // amount_in_eur = amount * eurRate
    if (currency !== "EUR") {
      const { rates } = await getExchangeRates();
      const rate = rates[currency.toLowerCase()];
      if (rate) eurRate = 1 / rate;
    }

    const totals = buildQuoteTotals(validated.items, validated.discountPercent || 0, validated.taxPercent);

    // The workspace's standard validity and conditions (Settings → General), for what the
    // form left empty. Copied into the quote, never read again: a change to the defaults
    // does not rewrite a quote already sent.
    const defaults = await readQuoteDefaults(db);
    const expiresAt = validated.expiresAt
      ? new Date(validated.expiresAt)
      : defaultExpiry(new Date(), defaults.validityDays);
    const notes = validated.notes?.trim() ? validated.notes : defaults.terms || validated.notes || null;

    const quoteNumber = generateQuoteNumber();
    // Chosen here rather than by the database default, so the lines can be written
    // in the same transaction as the header instead of waiting to learn the id.
    const quoteId = crypto.randomUUID();

    const itemRows = validated.items.map((item, i) => {
      const line = totals.lines[i];
      return {
        quoteId,
        productId: item.productId || null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        discountPercent: (item.discountPercent ?? 0).toString(),
        discountAmount: line.discountAmount.toString(),
        taxPercent: line.taxPercent.toString(),
        taxAmount: line.taxAmount.toString(),
        totalPrice: line.total.toString(),
      };
    });

    // Header and lines commit together. Separately, a failure between them left a
    // quote whose totals described lines that were never written (rilievo M-04).
    // `db.transaction()` is not an option: the Neon HTTP driver throws on it.
    // `db.batch()` maps to Neon's transaction endpoint, which is a real
    // BEGIN/COMMIT — at the cost that no statement may read another's output,
    // which is why the id is chosen above.
    const [insertedQuotes] = await db.batch([
      db
        .insert(quotes)
        .values({
          id: quoteId,
          quoteNumber,
          dealId: validated.dealId,
          companyId: validated.companyId,
          contactId: validated.contactId || null,
          ownerId: actor.userId,
          status: "draft",
          currency,
          eurRate: eurRate.toString(),
          subtotal: totals.subtotal.toString(),
          discountAmount: totals.discountAmount.toString(),
          discountPercent: totals.discountPercent.toString(),
          taxAmount: totals.taxAmount.toString(),
          taxPercent: (validated.taxPercent || 0).toString(),
          totalAmount: totals.total.toString(),
          expiresAt,
          notes,
        })
        .returning(),
      db.insert(quoteItems).values(itemRows),
    ]);

    const quote = insertedQuotes[0];

    // Log activity
    await logQuoteActivity(quote.id, "created", actor.userId);

    revalidatePath("/dashboard/sales/quotes");
    return { success: true, quoteId: quote.id, quoteNumber };
  } catch (error) {
    console.error("[createQuoteAction]", error);
    throw error;
  }
}

export async function getQuoteById(quoteId: string) {
  const db = await getDb();
  try {
    const actor = await requireCapability("record:read");
    await requirePlanModule("sales");
    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
      with: {
        deal: true,
        company: true,
        contact: true,
        owner: { columns: USER_SUMMARY_COLUMNS },
        items: {
          with: {
            product: true,
          },
        },
        activities: {
          with: {
            user: { columns: USER_SUMMARY_COLUMNS },
          },
          orderBy: desc(quoteActivities.createdAt),
        },
      },
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // Check permission: owner, deal owner, or admin
    const isAuthorized =
      actor.userId === quote.ownerId || actor.userId === quote.deal.ownerId || can(actor, "record:manageAny");

    if (!isAuthorized) {
      throw new Error("Unauthorized");
    }

    return quote;
  } catch (error) {
    console.error("[getQuoteById]", error);
    throw error;
  }
}

export async function getQuotesByDeal(dealId: string) {
  const db = await getDb();
  try {
    await requireCapability("record:read");
    await requirePlanModule("sales");
    const quoteList = await db.query.quotes.findMany({
      where: eq(quotes.dealId, dealId),
      orderBy: desc(quotes.createdAt),
      with: {
        items: true,
        activities: {
          orderBy: desc(quoteActivities.createdAt),
        },
      },
    });

    return quoteList;
  } catch (error) {
    console.error("[getQuotesByDeal]", error);
    throw error;
  }
}

export async function updateQuoteAction(quoteId: string, data: z.infer<typeof UpdateQuoteSchema>) {
  const db = await getDb();
  try {
    const actor = await requireCapability("quote:write");
    await requirePlanModule("sales");
    const validated = UpdateQuoteSchema.parse(data);
    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // The owner, or anyone who can approve quotes. The old check compared against
    // the platform role, so a workspace admin could not touch a colleague's quote.
    const mayEditOthers = can(actor, "quote:approve");
    if (actor.userId !== quote.ownerId && !mayEditOthers) {
      throw new ForbiddenError("Only the quote's owner or a workspace admin can change it.");
    }
    // ⚠️⚠️ What was sent does not change under the customer. Lines, prices, notes, expiry and
    // recipient are a draft's to change: after it, the customer may be reading — or signing —
    // the old text (src/lib/quote-signature.ts builds the PDF from the rows at that moment), and
    // an approved quote would change after its approval. Another version is a revision (§7.3).
    const CONTENT = [
      "items",
      "notes",
      "discountPercent",
      "taxPercent",
      "dealId",
      "companyId",
      "contactId",
      "expiresAt",
    ] as const;
    if (quote.status !== "draft" && CONTENT.some((k) => validated[k] !== undefined)) {
      throw new Error("Only a draft can be edited. Create a revision to change a quote that has left draft.");
    }

    // A status could previously be set to anything from anything: `sent` straight
    // from a draft that needed approval, or `accepted` rolled back to `draft`,
    // rewriting acceptedAt on the way (audit rilievo D-03).
    if (validated.status && validated.status !== quote.status) {
      if (!canTransition(quote.status, validated.status)) {
        throw new Error(transitionError(quote.status, validated.status));
      }

      // Approval that only applies when someone remembers to ask for it is not a
      // control. Above the workspace threshold, the quote has to be approved first.
      if (validated.status === "sent" && quote.status !== "approved") {
        const tenantId = await getCurrentTenantId();
        const tenant = tenantId ? await getTenantById(tenantId) : null;
        const lines = await db
          .select({ discountPercent: quoteItems.discountPercent })
          .from(quoteItems)
          .where(eq(quoteItems.quoteId, quoteId));
        const reason = approvalRequiredReason(quote, await readApprovalPolicy(db, tenant?.settings), lines);
        if (reason) {
          throw new Error(`${reason} Submit it for approval before sending.`);
        }
      }
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (validated.status) updateData.status = validated.status;
    if (validated.notes !== undefined) updateData.notes = validated.notes;
    if (validated.dealId) updateData.dealId = validated.dealId;
    if (validated.companyId) updateData.companyId = validated.companyId;
    if (validated.contactId !== undefined) updateData.contactId = validated.contactId || null;
    if (validated.expiresAt !== undefined) {
      updateData.expiresAt = validated.expiresAt ? new Date(validated.expiresAt) : null;
    }

    // Recalculate through the same function creation uses. These were two separate
    // implementations, and only one of them converted currency, so opening and
    // saving a non-EUR quote silently changed its value (audit rilievo C-03).
    let rewriteItems: (() => Promise<unknown>) | null = null;

    if (validated.items && validated.items.length > 0) {
      const totals = buildQuoteTotals(validated.items, validated.discountPercent || 0, validated.taxPercent);

      const rows = validated.items.map((item, i) => {
        const line = totals.lines[i];
        return {
          quoteId,
          productId: item.productId || null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discountPercent: (item.discountPercent ?? 0).toString(),
          discountAmount: line.discountAmount.toString(),
          taxPercent: line.taxPercent.toString(),
          taxAmount: line.taxAmount.toString(),
          totalPrice: line.total.toString(),
        };
      });

      // Deferred so the delete, the re-insert and the header update commit
      // together. Run separately, a failure between the delete and the insert
      // left a quote with no lines and a total that described lines that no
      // longer existed (audit rilievo M-04).
      rewriteItems = () =>
        db.batch([db.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId)), db.insert(quoteItems).values(rows)]);

      updateData.subtotal = totals.subtotal.toString();
      updateData.discountAmount = totals.discountAmount.toString();
      updateData.discountPercent = totals.discountPercent.toString();
      updateData.taxAmount = totals.taxAmount.toString();
      updateData.taxPercent = (validated.taxPercent || 0).toString();
      updateData.totalAmount = totals.total.toString();
    }

    // Update status timestamps
    if (validated.status === "sent") {
      updateData.sentAt = new Date();
    } else if (validated.status === "accepted") {
      updateData.acceptedAt = new Date();
    } else if (validated.status === "declined") {
      updateData.declinedAt = new Date();
      if (validated.declineReason?.trim()) updateData.declineReason = validated.declineReason.trim();
    }

    if (rewriteItems) await rewriteItems();
    const [updated] = await db.update(quotes).set(updateData).where(eq(quotes.id, quoteId)).returning();

    // Log activity
    if (validated.status) {
      await logQuoteActivity(quoteId, validated.status, actor.userId);
    }

    // ⚠️⚠️ The moment the owner says the quote is ready to leave, and the only one an
    // integration can act on. Until now nothing was emitted here at all: an assistant
    // waiting to hand this document to the customer would have waited forever, and
    // nothing would have failed.
    //
    // The address is a PDF the recipient can actually open: the public-token route
    // returns the rendered document without a session. Sending the HTML page instead
    // would arrive at the customer labelled as a PDF and open as something else.
    if (validated.status === "sent" && !hasAlreadyLeft(quote.status)) {
      // ⚠️ Awaited, unlike the fire-and-forget dispatches elsewhere in this codebase.
      // On Workers a promise still running after the response can be killed, and the row
      // this event's redelivery is derived from would never be written: the event would be
      // lost with nothing to retry from. Everywhere else that costs a log line; here it
      // costs a customer never receiving their quote.
      await announceQuoteSent(updated, actor.userId);
    }
    // The same answer can arrive from the customer's own page or be recorded here by whoever
    // heard it on the phone. Both are the answer, and an integration must not have to guess
    // which door it came through.
    if ((validated.status === "accepted" || validated.status === "declined") && quote.status !== validated.status) {
      await announceQuoteDecision(updated, validated.status, actor.userId);
    }

    revalidatePath("/dashboard/sales/quotes");
    revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
    return { success: true, quote: updated };
  } catch (error) {
    console.error("[updateQuoteAction]", error);
    throw error;
  }
}

/**
 * "The customer wants 5% less": a new revision of a quote already sent (§7.3).
 *
 * ⚠️ Only a draft could be edited and `version` never grew, so a counter-offer meant typing
 * the quote again from nothing — and the one the customer holds said something else, with
 * no trace of which was current. A revision copies the quote and its lines as a new draft
 * at the next version, and marks the one it replaces as superseded: its public page can no
 * longer be accepted, and the timeline says what replaced it.
 */
export async function createQuoteRevisionAction(quoteId: string): Promise<{ quoteId: string; quoteNumber: string }> {
  const actor = await requireCapability("quote:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (!canTransition(quote.status, "superseded")) throw new Error(transitionError(quote.status, "superseded"));
  if (actor.userId !== quote.ownerId && !can(actor, "quote:approve")) {
    throw new ForbiddenError("Only the quote's owner or a workspace admin can revise it.");
  }
  const lines = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));

  const version = (quote.version ?? 1) + 1;
  const newId = crypto.randomUUID();
  const newNumber = revisionNumber(quote.quoteNumber, version);
  const now = new Date();
  const {
    id: _id,
    quoteNumber: _number,
    publicToken: _token,
    createdAt: _created,
    updatedAt: _updated,
    ...header
  } = quote;
  await db.batch([
    db.insert(quotes).values({
      ...header,
      id: newId,
      quoteNumber: newNumber,
      version,
      status: "draft",
      ownerId: actor.userId,
      approvalNote: null,
      approvedById: null,
      approvedAt: null,
      issuedAt: now,
      sentAt: null,
      viewedAt: null,
      acceptedAt: null,
      declinedAt: null,
      declineReason: null,
    }),
    ...(lines.length
      ? [
          db
            .insert(quoteItems)
            .values(lines.map(({ id: _lineId, quoteId: _q, ...line }) => ({ ...line, quoteId: newId }))),
        ]
      : []),
    db.update(quotes).set({ status: "superseded", updatedAt: now }).where(eq(quotes.id, quoteId)),
  ] as unknown as Parameters<typeof db.batch>[0]);
  await logQuoteActivity(quoteId, "superseded", actor.userId);
  await logQuoteActivity(newId, "created", actor.userId);

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
  return { quoteId: newId, quoteNumber: newNumber };
}

export async function deleteQuoteAction(quoteId: string) {
  const db = await getDb();
  try {
    const actor = await requireCapability("quote:write");
    await requirePlanModule("sales");
    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // Only draft quotes can be deleted
    if (quote.status !== "draft") {
      throw new Error("Only draft quotes can be deleted");
    }

    // Check permission
    if (actor.userId !== quote.ownerId && !can(actor, "record:manageAny")) {
      throw new Error("Unauthorized");
    }

    await db.delete(quotes).where(eq(quotes.id, quoteId));

    revalidatePath("/dashboard/sales/quotes");
    return { success: true };
  } catch (error) {
    console.error("[deleteQuoteAction]", error);
    throw error;
  }
}

/**
 * A quote sent to the customer from the email dialog (src/components/crm/send-email-modal.tsx):
 * the person's text, then the quote's summary and the button that opens it. The first send moves
 * the quote to "sent"; a later one is a reminder.
 *
 * ⚠️ Returns its failures, never throws them: a thrown message never reaches the screen in
 * production, and a refused send must say why (an approval pending, a status that cannot be sent).
 */
/**
 * What the quote itself adds under the person's text: its number, its total, until when, and the
 * button that opens it — so no version of the email can leave without them.
 */
function quoteEmailFinish(
  quote: Pick<typeof quotes.$inferSelect, "publicToken" | "quoteNumber" | "totalAmount" | "currency" | "expiresAt"> & {
    company: { language?: string | null; country?: string | null } | null;
  },
): { finish: (body: string, kit: EmailKit) => string; lang: DocumentLanguage } {
  // ⚠️ The link used a fresh hash of the id and the time, saved nowhere, so every
  // customer received a "View quote" button that opened a not-found page. The
  // public page looks quotes up by `publicToken`; that is the link.
  const quoteViewUrl = appUrl(`/q/${quote.publicToken}`);

  // In the customer's language and the quote's currency, whoever sends it.
  const lang = documentLanguage(quote.company);
  const tx = QUOTE_TEXT[lang];
  const total = formatDocumentMoney(quote.totalAmount, quote.currency, lang);
  const expires = quote.expiresAt ? formatDocumentDate(quote.expiresAt, lang) : null;
  const finish = (body: string, { brand, signature }: EmailKit) =>
    brandFrame({
      brand,
      lang,
      label: `${tx.documentTitle} ${quote.quoteNumber}`,
      preheader: expires
        ? fill(tx.emailPreheader, { number: quote.quoteNumber, total, date: expires })
        : fill(tx.emailPreheaderNoDate, { number: quote.quoteNumber, total }),
      body:
        body +
        summaryBox({
          highlight: { label: tx.total, value: total },
          rows: [[tx.emailNumber, quote.quoteNumber], ...(expires ? [[tx.expires, expires] as [string, string]] : [])],
        }) +
        ctaButton(brand, tx.emailCta, quoteViewUrl) +
        `<p style="margin:10px 0 24px;font-size:13px;color:#5d6475">${esc(tx.emailCtaHint)}</p>` +
        signature,
    });
  return { finish, lang };
}

/** The quote's email as the customer will receive it, without sending it or moving the quote. */
export async function previewQuoteEmailAction(
  quoteId: string,
  email: { subject: string; bodyHtml: string; signature?: boolean },
): Promise<EmailPreview> {
  const actor = await requireCapability("quote:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId), with: { company: true } });
  if (!quote) return { ok: false, error: (await serverT("serverErrors.quotes"))("notFound") };
  const { finish, lang } = quoteEmailFinish(quote);
  const composed = await composeEmail(
    db,
    { userId: actor.userId },
    {
      subject: email.subject,
      html: email.bodyHtml,
      dealId: quote.dealId ?? undefined,
      finish,
      lang,
      signature: email.signature === false ? "none" : "full",
    },
  );
  return { ok: true, subject: composed.subject, html: composed.html };
}

export async function sendQuoteEmailAction(
  quoteId: string,
  email: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    bodyHtml: string;
    templateId?: string;
    /** False when the person took the signature off this one email. */
    signature?: boolean;
  },
): Promise<{ success: true } | { success: false; error: string }> {
  const actor = await requireCapability("quote:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const t = await serverT("serverErrors.quotes");

  const quote = await db.query.quotes.findFirst({
    where: eq(quotes.id, quoteId),
    with: { company: true, contact: true },
  });
  if (!quote) return { success: false, error: t("notFound") };

  // Check permission
  if (actor.userId !== quote.ownerId && !can(actor, "record:manageAny")) {
    return { success: false, error: t("forbidden") };
  }

  // Decided before anything leaves: see decideQuoteSend. A refusal here costs nothing; a
  // refusal after the send is an email the customer has and the salesperson thinks failed.
  const tenantId = await getCurrentTenantId();
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  const lines = await db
    .select({ discountPercent: quoteItems.discountPercent })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));
  const decision = decideQuoteSend(
    quote.status,
    approvalRequiredReason(quote, await readApprovalPolicy(db, tenant?.settings), lines),
  );
  if (decision.kind === "refuse") {
    console.warn(`[sendQuoteEmailAction] refused: ${decision.reason}`);
    return { success: false, error: t("notSendable") };
  }

  const { finish, lang } = quoteEmailFinish(quote);

  // The person's text as written in the editor, then what the quote itself says: its number,
  // its total, until when, and the button — so no version of the email can leave without them.
  const sent = await deliverEmail(
    db,
    { userId: actor.userId },
    {
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html: email.bodyHtml,
      sender: "person",
      dealId: quote.dealId ?? undefined,
      log: {
        contactId: quote.contactId,
        companyId: quote.companyId,
        dealId: quote.dealId,
        document: { type: "quote", id: quote.id, number: quote.quoteNumber },
      },
      templateId: email.templateId,
      finish,
      lang,
      signature: email.signature === false ? "none" : "full",
    },
  );
  // ⚠️ A send that did not leave moves nothing: a quote whose email never went was marked sent,
  // and the follow-up engine then waited on a customer who had received nothing.
  if (!sent.success) return sent;

  const to = email.to.trim().toLowerCase();
  if (decision.kind === "first") {
    await updateQuoteAction(quoteId, { status: "sent" });
    await logQuoteActivity(quoteId, "sent", actor.userId, to);
  } else {
    await logQuoteActivity(quoteId, "reminded", actor.userId, to);
  }
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
  return { success: true };
}

export async function markQuoteAsViewedAction(quoteId: string, email?: string, ipAddress?: string) {
  const db = await getDb();
  try {
    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // Update viewed timestamp
    const [_updated] = await db.update(quotes).set({ viewedAt: new Date() }).where(eq(quotes.id, quoteId)).returning();

    // Log activity
    await logQuoteActivity(quoteId, "viewed", undefined, email, ipAddress);

    return { success: true };
  } catch (error) {
    console.error("[markQuoteAsViewedAction]", error);
    throw error;
  }
}

// ── Approval Workflow ──────────────────────────────────────────────────────────

export async function requestApprovalAction(quoteId: string) {
  const db = await getDb();
  const actor = await requireCapability("quote:write");
  await requirePlanModule("sales");

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "draft") throw new Error("Only draft quotes can be submitted for approval");
  if (actor.userId !== quote.ownerId && !can(actor, "record:manageAny")) {
    throw new Error("Unauthorized");
  }

  // Whoever may approve, in this workspace. See membersWith for why not `users.role`.
  const tenantId = await getCurrentTenantId();
  const approvers = tenantId ? await membersWith(tenantId, "quote:approve") : [];

  await Promise.all([
    db.update(quotes).set({ status: "pending_approval", updatedAt: new Date() }).where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "approval_requested", actor.userId),
    notifyMany(
      approvers
        .filter((id) => id !== actor.userId)
        .map((id) => ({
          userId: id,
          type: "quote_approval_requested",
          key: "quoteApprovalRequested" as const,
          params: { number: quote.quoteNumber },
          link: `/dashboard/sales/quotes/${quoteId}`,
        })),
    ),
  ]);

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

export async function approveQuoteAction(quoteId: string) {
  const db = await getDb();
  const actor = await requireCapability("quote:approve");
  await requirePlanModule("sales");

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "pending_approval") throw new Error("Quote is not pending approval");

  await Promise.all([
    db
      .update(quotes)
      .set({
        // "approved", not back to "draft". Approve and reject both returned the
        // quote to draft, so an approved quote and a rejected one were the same
        // record and nothing stopped the owner sending either (audit rilievo D-03).
        status: "approved",
        approvedById: actor.userId,
        approvedAt: new Date(),
        approvalNote: null,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "approved", actor.userId),
  ]);

  if (quote.ownerId && quote.ownerId !== actor.userId) {
    await notify({
      userId: quote.ownerId,
      type: "quote_approved",
      key: "quoteApproved",
      params: { number: quote.quoteNumber },
      link: `/dashboard/sales/quotes/${quoteId}`,
    });
  }

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

export async function rejectQuoteAction(quoteId: string, note: string) {
  const db = await getDb();
  const actor = await requireCapability("quote:approve");
  await requirePlanModule("sales");

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "pending_approval") throw new Error("Quote is not pending approval");

  await Promise.all([
    db
      .update(quotes)
      // Back to draft with the reason attached: the owner has to change something
      // before asking again, which is the point of a rejection.
      .set({ status: "draft", approvalNote: note || null, approvedAt: null, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "rejected", actor.userId),
  ]);

  if (quote.ownerId && quote.ownerId !== actor.userId) {
    await notify({
      userId: quote.ownerId,
      type: "quote_rejected",
      key: "quoteRejected",
      params: { number: quote.quoteNumber, hasReason: note ? "yes" : "no", reason: note ?? "" },
      link: `/dashboard/sales/quotes/${quoteId}`,
    });
  }

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

/**
 * Lightweight list of deals, companies, contacts and products for the quote form.
 *
 * The contacts are new. `contactId` has always been part of the quote and there
 * was no field to set it, so every quote written here had nobody to send it to —
 * and a quote is a document whose whole purpose is being sent to a person.
 */
export async function getQuoteFormData() {
  const db = await getDb();
  await requireCapability("record:read");
  await requirePlanModule("sales");

  const [dealList, companyList, contactList, productList] = await Promise.all([
    db
      .select({ id: deals.id, name: deals.name, companyId: deals.companyId, contactId: deals.contactId })
      .from(deals)
      .orderBy(desc(deals.createdAt)),
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name),
    db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        companyId: contacts.companyId,
      })
      .from(contacts)
      .orderBy(contacts.firstName),
    db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        taxPercent: products.taxPercent,
        unit: products.unit,
        category: products.category,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(products.name),
  ]);

  return {
    deals: dealList,
    companies: companyList,
    contacts: contactList,
    products: productList,
    // What a new quote starts with: prefilled in the form, so what is sent is what is seen.
    defaults: await readQuoteDefaults(db),
  };
}

// ── One page of quotes ────────────────────────────────────────────────────────

/** The columns the list may be sorted by, and nothing else. */
const QUOTE_SORTS = {
  quoteNumber: quotes.quoteNumber,
  status: quotes.status,
  totalAmount: quotes.totalAmount,
  issuedAt: quotes.issuedAt,
  expiresAt: quotes.expiresAt,
  createdAt: quotes.createdAt,
} as const;

/**
 * One page of quotes, with the total that matches the query.
 *
 * ⚠️ Replaces `getAllQuotes`, which read every quote **with every line item of
 * every quote** through a relational query, then searched the result in
 * JavaScript. A workspace with two thousand quotes averaging four lines shipped
 * ten thousand rows to the browser so somebody could look at fifty — and the
 * search box could not start narrowing until all of it had arrived.
 *
 * The line items are not here on purpose: the list shows a total, and the total
 * is a column on the quote.
 */
export async function listQuotes(params: ListParams, status?: string) {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();

  const term = params.search.trim();
  const clauses: (SQL | undefined)[] = [
    // "awaiting": with the customer, sent or opened — the figure the home page adds up.
    status === "awaiting"
      ? inArray(quotes.status, ["sent", "viewed"])
      : status && status !== "all"
        ? eq(quotes.status, status)
        : undefined,
    term
      ? or(
          ilike(quotes.quoteNumber, `%${term}%`),
          ilike(companies.name, `%${term}%`),
          ilike(deals.name, `%${term}%`),
          ilike(contacts.firstName, `%${term}%`),
          ilike(contacts.lastName, `%${term}%`),
        )
      : undefined,
  ];
  const where = clauses.filter(Boolean).length ? and(...(clauses.filter(Boolean) as SQL[])) : undefined;

  const sortCol = params.sort ? QUOTE_SORTS[params.sort as keyof typeof QUOTE_SORTS] : undefined;
  const order = sortCol ? (params.dir === "asc" ? asc(sortCol) : desc(sortCol)) : desc(quotes.createdAt);

  // ⚠️ The count carries the same joins as the rows. Searching on a company name
  // means the join decides which quotes match, and a count taken without it would
  // report a total the pages cannot reach.
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        status: quotes.status,
        totalAmount: quotes.totalAmount,
        currency: quotes.currency,
        issuedAt: quotes.issuedAt,
        expiresAt: quotes.expiresAt,
        createdAt: quotes.createdAt,
        companyName: companies.name,
        dealName: deals.name,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(quotes)
      .leftJoin(companies, eq(quotes.companyId, companies.id))
      .leftJoin(deals, eq(quotes.dealId, deals.id))
      .leftJoin(contacts, eq(quotes.contactId, contacts.id))
      .where(where)
      .orderBy(order)
      .limit(params.pageSize)
      .offset(offsetOf(params)),
    db
      .select({ n: count() })
      .from(quotes)
      .leftJoin(companies, eq(quotes.companyId, companies.id))
      .leftJoin(deals, eq(quotes.dealId, deals.id))
      .leftJoin(contacts, eq(quotes.contactId, contacts.id))
      .where(where),
  ]);

  return toPage(rows, Number(counted?.n ?? 0), params);
}

/**
 * The four figures above the quotes list, counted over every quote in the
 * workspace rather than over the page on screen.
 *
 * ⚠️ The total value is grouped by currency and not summed across them. The page
 * used to add every `totalAmount` together and print the result with a `$` in
 * front of it, which was wrong twice: the symbol was hardcoded while the column
 * defaults to EUR, and a workspace quoting in two currencies got their sum —
 * a number that means nothing in either one.
 */
export async function getQuoteStats() {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();

  const [[counted], byCurrency] = await Promise.all([
    db
      .select({
        total: count(),
        sent: sql<number>`count(*) filter (where ${quotes.status} in ('sent', 'viewed'))`,
        accepted: sql<number>`count(*) filter (where ${quotes.status} = 'accepted')`,
      })
      .from(quotes),
    db
      .select({ currency: quotes.currency, amount: sql<string>`coalesce(sum(${quotes.totalAmount}), 0)` })
      .from(quotes)
      .groupBy(quotes.currency)
      .orderBy(desc(sql`coalesce(sum(${quotes.totalAmount}), 0)`)),
  ]);

  return {
    total: Number(counted?.total ?? 0),
    sent: Number(counted?.sent ?? 0),
    accepted: Number(counted?.accepted ?? 0),
    totals: byCurrency.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
  };
}

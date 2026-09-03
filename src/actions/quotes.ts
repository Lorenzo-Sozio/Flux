"use server";

import { revalidatePath } from "next/cache";

import crypto from "node:crypto";

import { desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import { createNotificationAction, createNotificationsBatch } from "@/actions/auth";
import { CreateQuoteSchema, UpdateQuoteSchema } from "@/actions/quotes-validation";
import { companies, deals, products, quoteActivities, quoteItems, quotes, users } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { ForbiddenError, requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { computeDocument } from "@/lib/document-totals";
import { sendEmail } from "@/lib/email-provider";
import { getExchangeRates } from "@/lib/exchange-rates";
import { getTenantById } from "@/lib/get-tenant";
import { can } from "@/lib/permissions";
import { announceQuoteDecision, announceQuoteSent, hasAlreadyLeft } from "@/lib/quote-events";
import { approvalPolicyFrom, approvalRequiredReason, canTransition, transitionError } from "@/lib/quote-status";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

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

function generateQuoteNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `QT-${year}${month}-${random}`;
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
          expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
          notes: validated.notes,
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
        owner: true,
        items: {
          with: {
            product: true,
          },
        },
        activities: {
          with: {
            user: true,
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
      actor.userId === quote.ownerId || actor.userId === quote.deal.ownerId || actor.tenantRole === "admin";

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
        const reason = approvalRequiredReason(quote, approvalPolicyFrom(tenant?.settings));
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
    if (actor.userId !== quote.ownerId && actor.tenantRole !== "admin") {
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

export async function sendQuoteEmailAction(quoteId: string, toEmail: string, subject: string, message: string) {
  try {
    const actor = await requireCapability("quote:write");
    await requirePlanModule("sales");
    const db = await getDb();

    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
      with: {
        company: true,
        contact: true,
      },
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // Check permission
    if (actor.userId !== quote.ownerId && actor.tenantRole !== "admin") {
      throw new Error("Unauthorized");
    }

    // Generate public view token for quote (simplified: use quoteId + timestamp)
    const viewToken = crypto.createHash("sha256").update(`${quoteId}:${Date.now()}`).digest("hex");

    // Was `${process.env.NEXTAUTH_URL}/...`, which renders the literal string
    // "undefined/quotes/..." when the variable is unset — a link the customer
    // cannot open, delivered without any error (audit rilievo B-04).
    const quoteViewUrl = appUrl(`/q/${viewToken}`);

    // Build HTML email
    const html = `
      <h2>Quote: ${quote.quoteNumber}</h2>
      <p>${message}</p>
      <p><strong>Total: ${quote.currency} ${parseFloat(quote.totalAmount).toFixed(2)}</strong></p>
      <p><a href="${quoteViewUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">View Quote</a></p>
    `;

    // Send email
    await sendEmail({
      to: toEmail,
      subject,
      html,
    });

    // Update status and log activity
    await updateQuoteAction(quoteId, { status: "sent" });
    await logQuoteActivity(quoteId, "sent", actor.userId, toEmail);

    return { success: true };
  } catch (error) {
    console.error("[sendQuoteEmailAction]", error);
    throw error;
  }
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

export async function getAllQuotes(filters?: { status?: string; searchTerm?: string }) {
  const db = await getDb();
  try {
    await requireCapability("record:read");
    await requirePlanModule("sales");
    const statusFilter = filters?.status && filters.status !== "all" ? eq(quotes.status, filters.status) : undefined;

    const allQuotes = await db.query.quotes.findMany({
      where: statusFilter,
      with: { deal: true, company: true, contact: true, owner: true, items: true },
      orderBy: desc(quotes.createdAt),
    });

    if (filters?.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      return allQuotes.filter(
        (q) =>
          q.quoteNumber.toLowerCase().includes(term) ||
          q.company?.name?.toLowerCase().includes(term) ||
          q.deal?.name?.toLowerCase().includes(term) ||
          (q.contact ? `${q.contact.firstName} ${q.contact.lastName}`.toLowerCase().includes(term) : false),
      );
    }

    return allQuotes;
  } catch (error) {
    console.error("[getAllQuotes]", error);
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
  if (actor.userId !== quote.ownerId && actor.tenantRole !== "admin" && actor.tenantRole !== "owner") {
    throw new Error("Unauthorized");
  }

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ["admin", "owner"]));

  await Promise.all([
    db.update(quotes).set({ status: "pending_approval", updatedAt: new Date() }).where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "approval_requested", actor.userId),
    createNotificationsBatch(
      admins
        .filter((u) => u.id !== actor.userId)
        .map((u) => ({
          userId: u.id,
          type: "quote_approval_requested",
          title: "Quote awaiting your approval",
          message: `Quote ${quote.quoteNumber} needs your approval before it can be sent.`,
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
    await createNotificationAction({
      userId: quote.ownerId,
      type: "quote_approved",
      title: "Quote approved",
      message: `Quote ${quote.quoteNumber} is approved. You can send it to the customer.`,
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
    await createNotificationAction({
      userId: quote.ownerId,
      type: "quote_rejected",
      title: "Quote sent back",
      message: `Quote ${quote.quoteNumber} was not approved.${note ? ` Reason: ${note}` : ""}`,
      link: `/dashboard/sales/quotes/${quoteId}`,
    });
  }

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

/** Lightweight list of deals + companies + products for the quote creation form. */
export async function getQuoteFormData() {
  const db = await getDb();
  await requireCapability("record:read");
  await requirePlanModule("sales");

  const [dealList, companyList, productList] = await Promise.all([
    db
      .select({ id: deals.id, name: deals.name, companyId: deals.companyId, contactId: deals.contactId })
      .from(deals)
      .orderBy(desc(deals.createdAt)),
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name),
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

  return { deals: dealList, companies: companyList, products: productList };
}

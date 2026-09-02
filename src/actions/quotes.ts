"use server";

import { revalidatePath } from "next/cache";

import crypto from "node:crypto";

import { desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import { createNotificationAction, createNotificationsBatch } from "@/actions/auth";
import { CreateQuoteSchema, UpdateQuoteSchema } from "@/actions/quotes-validation";
import { auth } from "@/auth";
import { companies, deals, products, quoteActivities, quoteItems, quotes, users } from "@/db/schema";
import { requireAdminAccess, requireWriteAccess } from "@/lib/auth-guard";
import { sendEmail } from "@/lib/email-provider";
import { getExchangeRates } from "@/lib/exchange-rates";
import { announceQuoteDecision, announceQuoteSent } from "@/lib/quote-events";
import { getDb } from "@/lib/tenant-context";

// --- HELPERS ---
function calculateLineTotal(quantity: number, unitPrice: number, discountPercent: number, taxPercent: number) {
  const subtotal = quantity * unitPrice;
  const discountAmount = (subtotal * discountPercent) / 100;
  const subtotalAfterDiscount = subtotal - discountAmount;
  const taxAmount = (subtotalAfterDiscount * taxPercent) / 100;
  const totalPrice = subtotalAfterDiscount + taxAmount;

  return {
    discountAmount,
    taxAmount,
    totalPrice,
  };
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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const validated = CreateQuoteSchema.parse(data);

    // Verify deal exists
    const dealExists = await db.query.deals.findFirst({
      where: eq(deals.id, validated.dealId),
    });

    if (!dealExists) {
      throw new Error("Deal not found");
    }

    // Resolve EUR conversion rate for the input currency
    const inputCurrency = (validated.currency || "EUR").toUpperCase();
    let eurRate = 1; // multiplier: amount_in_eur = input_amount * eurRate
    if (inputCurrency !== "EUR") {
      const { rates } = await getExchangeRates();
      const rate = rates[inputCurrency.toLowerCase()];
      if (rate) eurRate = 1 / rate;
    }
    const toEur = (n: number) => n * eurRate;

    // Calculate totals (in input currency first, then convert)
    let subtotal = 0;
    const itemsData = validated.items.map((item) => {
      const { discountAmount, taxAmount, totalPrice } = calculateLineTotal(
        item.quantity,
        item.unitPrice,
        item.discountPercent || 0,
        item.taxPercent || 0,
      );
      subtotal += totalPrice;
      return { ...item, discountAmount, taxAmount, totalPrice };
    });

    // Calculate quote-level totals
    const quoteDiscountAmount = (subtotal * (validated.discountPercent || 0)) / 100;
    const subtotalAfterDiscount = subtotal - quoteDiscountAmount;
    const quoteTaxAmount = (subtotalAfterDiscount * (validated.taxPercent || 0)) / 100;
    const totalAmount = subtotalAfterDiscount + quoteTaxAmount;

    // Create quote — all monetary values stored in EUR
    const quoteNumber = generateQuoteNumber();
    const [quote] = await db
      .insert(quotes)
      .values({
        quoteNumber,
        dealId: validated.dealId,
        companyId: validated.companyId,
        contactId: validated.contactId || null,
        ownerId: session.user.id,
        status: "draft",
        currency: "EUR",
        subtotal: toEur(subtotal).toString(),
        discountAmount: toEur(quoteDiscountAmount).toString(),
        discountPercent: (validated.discountPercent || 0).toString(),
        taxAmount: toEur(quoteTaxAmount).toString(),
        taxPercent: (validated.taxPercent || 0).toString(),
        totalAmount: toEur(totalAmount).toString(),
        expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
        notes: validated.notes,
      })
      .returning();

    // Create quote items — all unit prices stored in EUR
    for (const item of itemsData) {
      await db.insert(quoteItems).values({
        quoteId: quote.id,
        productId: item.productId || null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: toEur(item.unitPrice).toString(),
        discountPercent: item.discountPercent.toString(),
        discountAmount: toEur(item.discountAmount).toString(),
        taxPercent: item.taxPercent.toString(),
        taxAmount: toEur(item.taxAmount).toString(),
        totalPrice: toEur(item.totalPrice).toString(),
      });
    }

    // Log activity
    await logQuoteActivity(quote.id, "created", session.user.id);

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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

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
      session.user.id === quote.ownerId || session.user.id === quote.deal.ownerId || session.user.role === "admin";

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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const validated = UpdateQuoteSchema.parse(data);
    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // Check permission
    if (session.user.id !== quote.ownerId && session.user.role !== "admin") {
      throw new Error("Unauthorized");
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

    // If items are being updated, recalculate totals
    if (validated.items && validated.items.length > 0) {
      // Delete old items
      await db.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));

      let subtotal = 0;
      const itemsData = validated.items.map((item) => {
        const { discountAmount, taxAmount, totalPrice } = calculateLineTotal(
          item.quantity,
          item.unitPrice,
          item.discountPercent || 0,
          item.taxPercent || 0,
        );
        subtotal += totalPrice;
        return { ...item, discountAmount, taxAmount, totalPrice };
      });

      // Create new items
      for (const item of itemsData) {
        await db.insert(quoteItems).values({
          quoteId,
          productId: item.productId || null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discountPercent: item.discountPercent.toString(),
          discountAmount: item.discountAmount.toString(),
          taxPercent: item.taxPercent.toString(),
          taxAmount: item.taxAmount.toString(),
          totalPrice: item.totalPrice.toString(),
        });
      }

      // Recalculate quote totals
      const quoteDiscountPercent = validated.discountPercent || 0;
      const quoteTaxPercent = validated.taxPercent || 0;
      const quoteDiscountAmount = (subtotal * quoteDiscountPercent) / 100;
      const subtotalAfterDiscount = subtotal - quoteDiscountAmount;
      const quoteTaxAmount = (subtotalAfterDiscount * quoteTaxPercent) / 100;
      const totalAmount = subtotalAfterDiscount + quoteTaxAmount;

      updateData.subtotal = subtotal.toString();
      updateData.discountAmount = quoteDiscountAmount.toString();
      updateData.discountPercent = quoteDiscountPercent.toString();
      updateData.taxAmount = quoteTaxAmount.toString();
      updateData.taxPercent = quoteTaxPercent.toString();
      updateData.totalAmount = totalAmount.toString();
    }

    // Update status timestamps
    if (validated.status === "sent") {
      updateData.sentAt = new Date();
    } else if (validated.status === "accepted") {
      updateData.acceptedAt = new Date();
    } else if (validated.status === "declined") {
      updateData.declinedAt = new Date();
    }

    const [updated] = await db.update(quotes).set(updateData).where(eq(quotes.id, quoteId)).returning();

    // Log activity
    if (validated.status) {
      await logQuoteActivity(quoteId, validated.status, session.user.id);
    }

    // ⚠️⚠️ The moment the owner says the quote is ready to leave, and the only one an
    // integration can act on. Until now nothing was emitted here at all: an assistant
    // waiting to hand this document to the customer would have waited forever, and
    // nothing would have failed.
    //
    // The address is a PDF the recipient can actually open: the public-token route
    // returns the rendered document without a session. Sending the HTML page instead
    // would arrive at the customer labelled as a PDF and open as something else.
    if (validated.status === "sent") {
      // ⚠️ Awaited, unlike the fire-and-forget dispatches elsewhere in this codebase.
      // On Workers a promise still running after the response can be killed, and the row
      // this event's redelivery is derived from would never be written: the event would be
      // lost with nothing to retry from. Everywhere else that costs a log line; here it
      // costs a customer never receiving their quote.
      await announceQuoteSent(updated, session.user.id);
    }
    // The same answer can arrive from the customer's own page or be recorded here by whoever
    // heard it on the phone. Both are the answer, and an integration must not have to guess
    // which door it came through.
    if (validated.status === "accepted" || validated.status === "declined") {
      await announceQuoteDecision(updated, validated.status, session.user.id);
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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

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
    if (session.user.id !== quote.ownerId && session.user.role !== "admin") {
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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }
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
    if (session.user.id !== quote.ownerId && session.user.role !== "admin") {
      throw new Error("Unauthorized");
    }

    // Generate public view token for quote (simplified: use quoteId + timestamp)
    const viewToken = crypto.createHash("sha256").update(`${quoteId}:${Date.now()}`).digest("hex");

    const quoteViewUrl = `${process.env.NEXTAUTH_URL}/quotes/${quoteId}?token=${viewToken}`;

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
    await logQuoteActivity(quoteId, "sent", session.user.id, toEmail);

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
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

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
  const session = await requireWriteAccess();

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "draft") throw new Error("Only draft quotes can be submitted for approval");
  if (session.user.id !== quote.ownerId && session.user.role !== "admin" && session.user.role !== "owner") {
    throw new Error("Unauthorized");
  }

  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, ["admin", "owner"]));

  await Promise.all([
    db.update(quotes).set({ status: "pending_approval", updatedAt: new Date() }).where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "approval_requested", session.user.id),
    createNotificationsBatch(
      admins
        .filter((u) => u.id !== session.user.id)
        .map((u) => ({
          userId: u.id,
          type: "quote_approval_requested",
          title: "Approvazione preventivo richiesta",
          message: `Il preventivo ${quote.quoteNumber} richiede la tua approvazione.`,
          link: `/dashboard/sales/quotes/${quoteId}`,
        })),
    ),
  ]);

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

export async function approveQuoteAction(quoteId: string) {
  const db = await getDb();
  const session = await requireAdminAccess();

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "pending_approval") throw new Error("Quote is not pending approval");

  await Promise.all([
    db
      .update(quotes)
      .set({
        status: "draft",
        approvedById: session.user.id,
        approvedAt: new Date(),
        approvalNote: null,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "approved", session.user.id),
  ]);

  if (quote.ownerId && quote.ownerId !== session.user.id) {
    await createNotificationAction({
      userId: quote.ownerId,
      type: "quote_approved",
      title: "Preventivo approvato",
      message: `Il preventivo ${quote.quoteNumber} è stato approvato. Puoi ora inviarlo al cliente.`,
      link: `/dashboard/sales/quotes/${quoteId}`,
    });
  }

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

export async function rejectQuoteAction(quoteId: string, note: string) {
  const db = await getDb();
  const session = await requireAdminAccess();

  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, quoteId) });
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "pending_approval") throw new Error("Quote is not pending approval");

  await Promise.all([
    db
      .update(quotes)
      .set({ status: "draft", approvalNote: note || null, updatedAt: new Date() })
      .where(eq(quotes.id, quoteId)),
    logQuoteActivity(quoteId, "rejected", session.user.id),
  ]);

  if (quote.ownerId && quote.ownerId !== session.user.id) {
    await createNotificationAction({
      userId: quote.ownerId,
      type: "quote_rejected",
      title: "Preventivo rifiutato",
      message: `Il preventivo ${quote.quoteNumber} è stato rifiutato.${note ? ` Nota: ${note}` : ""}`,
      link: `/dashboard/sales/quotes/${quoteId}`,
    });
  }

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
}

/** Lightweight list of deals + companies + products for the quote creation form. */
export async function getQuoteFormData() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

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

"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { quotes, quoteItems, quoteActivities, deals, companies, products } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "@/lib/email-provider";
import crypto from "crypto";
import { CreateQuoteSchema, UpdateQuoteSchema } from "@/actions/quotes-validation";
import { revalidatePath } from "next/cache";

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
  userAgent?: string
) {
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

    // Calculate totals
    let subtotal = 0;
    const itemsData = validated.items.map((item) => {
      const { discountAmount, taxAmount, totalPrice } = calculateLineTotal(
        item.quantity,
        item.unitPrice,
        item.discountPercent || 0,
        item.taxPercent || 0
      );
      subtotal += totalPrice;
      return { ...item, discountAmount, taxAmount, totalPrice };
    });

    // Calculate quote-level totals
    const quoteDiscountAmount = (subtotal * (validated.discountPercent || 0)) / 100;
    const subtotalAfterDiscount = subtotal - quoteDiscountAmount;
    const quoteTaxAmount = (subtotalAfterDiscount * (validated.taxPercent || 0)) / 100;
    const totalAmount = subtotalAfterDiscount + quoteTaxAmount;

    // Create quote
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
        subtotal: subtotal.toString(),
        discountAmount: quoteDiscountAmount.toString(),
        discountPercent: (validated.discountPercent || 0).toString(),
        taxAmount: quoteTaxAmount.toString(),
        taxPercent: (validated.taxPercent || 0).toString(),
        totalAmount: totalAmount.toString(),
        expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
        notes: validated.notes,
      })
      .returning();

    // Create quote items
    for (const item of itemsData) {
      await db.insert(quoteItems).values({
        quoteId: quote.id,
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

    // Log activity
    await logQuoteActivity(quote.id, "created", session.user.id);

    revalidatePath("/dashboard/quotes");
    return { success: true, quoteId: quote.id, quoteNumber };
  } catch (error) {
    console.error("[createQuoteAction]", error);
    throw error;
  }
}

export async function getQuoteById(quoteId: string) {
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
      session.user.id === quote.ownerId ||
      session.user.id === quote.deal.ownerId ||
      session.user.role === "admin";

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
          item.taxPercent || 0
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

    revalidatePath("/dashboard/quotes");
    revalidatePath(`/dashboard/quotes/${quoteId}`);
    return { success: true, quote: updated };
  } catch (error) {
    console.error("[updateQuoteAction]", error);
    throw error;
  }
}

export async function deleteQuoteAction(quoteId: string) {
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

    revalidatePath("/dashboard/quotes");
    return { success: true };
  } catch (error) {
    console.error("[deleteQuoteAction]", error);
    throw error;
  }
}

export async function sendQuoteEmailAction(
  quoteId: string,
  toEmail: string,
  subject: string,
  message: string
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

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
    const viewToken = crypto
      .createHash("sha256")
      .update(`${quoteId}:${Date.now()}`)
      .digest("hex");

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
  try {
    const quote = await db.query.quotes.findFirst({
      where: eq(quotes.id, quoteId),
    });

    if (!quote) {
      throw new Error("Quote not found");
    }

    // Update viewed timestamp
    const [updated] = await db
      .update(quotes)
      .set({ viewedAt: new Date() })
      .where(eq(quotes.id, quoteId))
      .returning();

    // Log activity
    await logQuoteActivity(quoteId, "viewed", undefined, email, ipAddress);

    return { success: true };
  } catch (error) {
    console.error("[markQuoteAsViewedAction]", error);
    throw error;
  }
}

export async function getAllQuotes(filters?: { status?: string; searchTerm?: string }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      throw new Error("Unauthorized");
    }

    const statusFilter =
      filters?.status && filters.status !== "all"
        ? eq(quotes.status, filters.status)
        : undefined;

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
          (q.contact
            ? `${q.contact.firstName} ${q.contact.lastName}`.toLowerCase().includes(term)
            : false)
      );
    }

    return allQuotes;
  } catch (error) {
    console.error("[getAllQuotes]", error);
    throw error;
  }
}

/** Lightweight list of deals + companies + products for the quote creation form. */
export async function getQuoteFormData() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const [dealList, companyList, productList] = await Promise.all([
    db
      .select({ id: deals.id, name: deals.name, companyId: deals.companyId, contactId: deals.contactId })
      .from(deals)
      .orderBy(desc(deals.createdAt)),
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name),
    db.select({ id: products.id, name: products.name, price: products.price }).from(products).orderBy(products.name),
  ]);

  return { deals: dealList, companies: companyList, products: productList };
}

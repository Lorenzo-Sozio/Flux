"use server";

import { revalidatePath } from "next/cache";

import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { dispatchWebhook } from "@/actions/webhooks";
import { companies, contacts, orderItems, orders, products, users } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { computeDocument } from "@/lib/document-totals";
import { getDb } from "@/lib/tenant-context";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStatus = "draft" | "processing" | "completed" | "cancelled";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The next order number for the current year.
 *
 * The previous version appended four random digits to a date. On a unique column
 * that means a collision surfaces to the user as a raw SQL error on a save they
 * believe succeeded, and a customer receives a document whose number carries no
 * sequence — which is not what a commercial document is for (audit rilievo C-05).
 *
 * Derived from the highest number already issued this year, so it survives the
 * absence of a database sequence and stays readable: ORD-2026-0007.
 */
async function nextOrderNumber(db: Awaited<ReturnType<typeof getDb>>): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;

  const [row] = await db
    .select({ last: sql<string | null>`max(${orders.orderNumber})` })
    .from(orders)
    .where(sql`${orders.orderNumber} LIKE ${`${prefix}%`}`);

  const lastSeq = row?.last ? Number.parseInt(row.last.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/**
 * Totals for an order, using the same arithmetic as a quote.
 *
 * Orders applied no tax at all and recomputed their total by summing line prices,
 * so the same content quoted and ordered showed two different figures. The tax
 * rate held on the product was never read (audit rilievo C-04).
 */
async function orderTotals(
  db: Awaited<ReturnType<typeof getDb>>,
  items: { productId: string; quantity: number; unitPrice: number; discountPercent?: number }[],
  discountPercent = 0,
) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const rows = ids.length
    ? await db
        .select({ id: products.id, taxPercent: products.taxPercent })
        .from(products)
        .where(inArray(products.id, ids))
    : [];
  const taxByProduct = new Map(rows.map((r) => [r.id, Number(r.taxPercent ?? 0)]));

  return computeDocument({
    lines: items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPercent: i.discountPercent ?? 0,
      taxPercent: taxByProduct.get(i.productId) ?? 0,
    })),
    discountPercent,
  });
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getOrders(search?: string) {
  const db = await getDb();
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalAmount: orders.totalAmount,
      orderDate: orders.orderDate,
      createdAt: orders.createdAt,
      companyId: orders.companyId,
      contactId: orders.contactId,
      ownerId: orders.ownerId,
      companyName: companies.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
      ownerName: users.name,
    })
    .from(orders)
    .leftJoin(companies, eq(orders.companyId, companies.id))
    .leftJoin(contacts, eq(orders.contactId, contacts.id))
    .leftJoin(users, eq(orders.ownerId, users.id))
    .where(search ? or(ilike(orders.orderNumber, `%${search}%`), ilike(companies.name, `%${search}%`)) : undefined)
    .orderBy(desc(orders.createdAt));

  return rows;
}

export async function getOrderById(id: string) {
  const db = await getDb();
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalAmount: orders.totalAmount,
      orderDate: orders.orderDate,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      companyId: orders.companyId,
      contactId: orders.contactId,
      quoteId: orders.quoteId,
      dealId: orders.dealId,
      ownerId: orders.ownerId,
      companyName: companies.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
      ownerName: users.name,
    })
    .from(orders)
    .leftJoin(companies, eq(orders.companyId, companies.id))
    .leftJoin(contacts, eq(orders.contactId, contacts.id))
    .leftJoin(users, eq(orders.ownerId, users.id))
    .where(eq(orders.id, id));

  if (!order) return null;

  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      totalPrice: orderItems.totalPrice,
      productName: products.name,
      productSku: products.sku,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, id));

  return { ...order, items };
}

// ── Stats for dashboard ───────────────────────────────────────────────────────

export async function getOrderStats() {
  const db = await getDb();
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      draft: sql<number>`count(*) filter (where ${orders.status} = 'draft')::int`,
      processing: sql<number>`count(*) filter (where ${orders.status} = 'processing')::int`,
      completed: sql<number>`count(*) filter (where ${orders.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} = 'cancelled')::int`,
      revenue: sql<number>`coalesce(sum(case when ${orders.status} = 'completed' then cast(${orders.totalAmount} as numeric) end), 0)`,
    })
    .from(orders);
  return counts;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

const createSchema = z.object({
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  quoteId: z.string().optional(),
  dealId: z.string().optional(),
  status: z.enum(["draft", "processing", "completed", "cancelled"]).default("draft"),
  orderDate: z.string().optional(),
  currency: z.string().default("EUR"),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        discountPercent: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1, "At least one item is required"),
});

export async function createOrder(data: z.input<typeof createSchema>) {
  const actor = await requireCapability("order:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const validated = createSchema.parse(data);

  // The order keeps the currency it was written in, like a quote does. Converting
  // everything to EUR and discarding the original made the document unreadable to
  // an international customer (audit rilievi C-02, C-04).
  const currency = (validated.currency || "EUR").toUpperCase();

  const totals = await orderTotals(db, validated.items, validated.discountPercent);

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: await nextOrderNumber(db),
      companyId: validated.companyId || null,
      contactId: validated.contactId || null,
      quoteId: validated.quoteId || null,
      dealId: validated.dealId || null,
      ownerId: actor.userId,
      status: validated.status,
      currency,
      subtotal: String(totals.subtotal),
      discountPercent: String(totals.discountPercent),
      discountAmount: String(totals.discountAmount),
      taxAmount: String(totals.taxAmount),
      totalAmount: String(totals.total),
      orderDate: validated.orderDate ? new Date(validated.orderDate) : new Date(),
    })
    .returning();

  await db.insert(orderItems).values(
    validated.items.map((item, i) => {
      const line = totals.lines[i];
      return {
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: String(item.unitPrice),
        discountPercent: String(item.discountPercent ?? 0),
        discountAmount: String(line.discountAmount),
        taxPercent: String(line.taxPercent),
        taxAmount: String(line.taxAmount),
        totalPrice: String(line.total),
      };
    }),
  );

  revalidatePath("/dashboard/sales/orders");

  // The pattern every other module follows and this one skipped entirely: no
  // webhook, no automation, no trace on the customer record. An order completing
  // is the moment the business gets paid, and nothing could react to it
  // (audit rilievo M-05).
  dispatchWebhook("order.created", {
    id: order.id,
    number: order.orderNumber,
    total: order.totalAmount,
    currency: order.currency,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  return order;
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  await requireCapability("order:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const [updated] = await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id)).returning();

  revalidatePath("/dashboard/sales/orders");
  revalidatePath(`/dashboard/sales/orders/${id}`);

  if (updated) {
    dispatchWebhook(`order.${status}`, {
      id: updated.id,
      number: updated.orderNumber,
      total: updated.totalAmount,
      currency: updated.currency,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});
  }
}

export async function addOrderItem(
  orderId: string,
  item: { productId: string; quantity: number; unitPrice: number; discountPercent?: number },
) {
  await requireCapability("order:write");
  await requirePlanModule("sales");
  const db = await getDb();

  await db.insert(orderItems).values({
    orderId,
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: String(item.unitPrice),
    discountPercent: String(item.discountPercent ?? 0),
    totalPrice: "0", // replaced by the recalculation below
  });

  await recalcOrder(db, orderId);
  revalidatePath(`/dashboard/sales/orders/${orderId}`);
}

export async function removeOrderItem(itemId: string, orderId: string) {
  await requireCapability("order:write");
  await requirePlanModule("sales");
  const db = await getDb();
  await db.delete(orderItems).where(eq(orderItems.id, itemId));
  await recalcOrder(db, orderId);
  revalidatePath(`/dashboard/sales/orders/${orderId}`);
}

/**
 * Recomputes an order from its lines.
 *
 * Adding a line used to sum raw line prices: no tax, no currency conversion, and
 * no header discount, so the total silently disagreed with the same document's
 * own figures the moment anyone edited it (audit rilievo C-04).
 */
async function recalcOrder(db: Awaited<ReturnType<typeof getDb>>, orderId: string) {
  const [order] = await db
    .select({ discountPercent: orders.discountPercent })
    .from(orders)
    .where(eq(orders.id, orderId));

  const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const totals = await orderTotals(
    db,
    rows.map((r) => ({
      productId: r.productId,
      quantity: r.quantity,
      unitPrice: Number(r.unitPrice),
      discountPercent: Number(r.discountPercent ?? 0),
    })),
    Number(order?.discountPercent ?? 0),
  );

  // Lines and header commit together. Run separately, a failure partway through
  // left an order whose total no longer matched the lines under it — and the total
  // is the number the customer signed (audit rilievo M-04). `db.transaction()`
  // throws on the Neon HTTP driver; `db.batch()` maps to its transaction endpoint.
  const writes = rows.map((r, i) => {
    const line = totals.lines[i];
    return db
      .update(orderItems)
      .set({
        discountAmount: String(line.discountAmount),
        taxPercent: String(line.taxPercent),
        taxAmount: String(line.taxAmount),
        totalPrice: String(line.total),
      })
      .where(eq(orderItems.id, r.id));
  });

  const updateHeader = db
    .update(orders)
    .set({
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxAmount: String(totals.taxAmount),
      totalAmount: String(totals.total),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  // The two statement kinds have different generic types; drizzle's batch signature
  // wants one tuple element type, so the array is widened at the call.
  const batch = [...writes, updateHeader] as unknown as Parameters<typeof db.batch>[0];
  await db.batch(batch);
}

export async function deleteOrder(id: string) {
  // Deleting a commercial document is an admin act, and only while it is still a
  // draft. A completed order is a record of something that happened.
  await requireCapability("order:delete");
  await requirePlanModule("sales");
  const db = await getDb();

  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id));
  if (!order) throw new Error("Order not found");
  if (order.status !== "draft" && order.status !== "cancelled") {
    throw new Error("Only draft or cancelled orders can be deleted. Cancel it instead.");
  }

  await db.delete(orders).where(eq(orders.id, id));
  revalidatePath("/dashboard/sales/orders");
}

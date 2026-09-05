"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { dispatchWebhook } from "@/actions/webhooks";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import {
  activities,
  companies,
  contacts,
  deals,
  orderItems,
  orders,
  products,
  quoteItems,
  quotes,
  users,
} from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { computeDocument } from "@/lib/document-totals";
import { nextOrderNumber } from "@/lib/order-number";
import type { OrderStatus } from "@/lib/order-status";
import { getDb } from "@/lib/tenant-context";

// ── Types ─────────────────────────────────────────────────────────────────────

// One definition, in a module a client component can import: the page needs the
// flow as a value, and a "use server" file cannot hand one over.
export type { OrderStatus };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Totals for an order, using the same arithmetic as a quote.
 *
 * Orders applied no tax at all and recomputed their total by summing line prices,
 * so the same content quoted and ordered showed two different figures. The tax
 * rate held on the product was never read (audit rilievo C-04).
 */
async function orderTotals(
  db: Awaited<ReturnType<typeof getDb>>,
  // A line need not be in the catalogue: a one-off carries its own tax rate
  // instead of borrowing a product's (rilievo S-03).
  items: {
    productId?: string | null;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    taxPercent?: number;
  }[],
  discountPercent = 0,
) {
  const ids = [...new Set(items.map((i) => i.productId).filter((id): id is string => Boolean(id)))];
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
      // The rate written on the line wins: it is what the customer was quoted,
      // and the product's rate may have changed since.
      taxPercent: i.taxPercent ?? (i.productId ? (taxByProduct.get(i.productId) ?? 0) : 0),
    })),
    discountPercent,
  });
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * The order's trace on the customer's own record.
 *
 * An order is something that happened to a customer, and the timeline on the
 * company, the contact and the deal is where a person goes to find out what
 * happened. Nothing was ever written there, so an order existed only for whoever
 * thought to open the orders list (audit rilievo M-05).
 *
 * An order attached to nobody gets no row: there is no timeline for it to appear
 * on, and a record no page can reach is weight, not memory.
 */
async function recordOrderActivity(
  db: Awaited<ReturnType<typeof getDb>>,
  order: { companyId: string | null; contactId: string | null; dealId: string | null; ownerId: string | null },
  content: string,
) {
  if (!order.companyId && !order.contactId && !order.dealId) return;
  try {
    await db.insert(activities).values({
      type: "order",
      content,
      date: new Date(),
      ownerId: order.ownerId,
      companyId: order.companyId,
      contactId: order.contactId,
      dealId: order.dealId,
    });
  } catch (err) {
    // A trace that cannot be written is worth a line in the log, not the rules
    // that were due to run after it.
    console.error("[orders] Could not record the order activity:", err);
  }
}

export async function getOrders(search?: string) {
  await requireCapability("record:read");
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
  await requireCapability("record:read");
  const db = await getDb();
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalAmount: orders.totalAmount,
      // What has to be known to prepare it: pickup or delivery, when, where.
      notes: orders.notes,
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
      // ⚠️ **What a line without a product says it is.** `product_id` became optional so
      // that an order could carry a one-off — a customisation, a day of consulting, a
      // pizza priced from the business's own list — but nothing read the column that says
      // what it is, so the detail page showed «Unknown». The write side was opened and the
      // read side was not.
      description: orderItems.description,
      // What was asked for on this line, in full: see `orderItems.notes`.
      itemNotes: orderItems.notes,
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
  await requireCapability("report:read");
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

/**
 * A line on an order.
 *
 * Either a catalogue product or something written out by hand. The database has
 * allowed the second since migration 0004, and this schema was still refusing it,
 * so an order could not carry a customisation, a day of consulting or a one-off
 * charge — which is most of what a real order has on it beyond the catalogue.
 *
 * A line with a product takes its tax rate from the product; a free-text line has
 * nowhere else to get one, so it carries its own.
 */
const orderItemSchema = z
  .object({
    productId: z.string().optional(),
    description: z.string().max(500).optional(),
    notes: z.string().max(500).optional(),
    quantity: z.coerce.number().int().min(1),
    unitPrice: z.coerce.number().min(0),
    discountPercent: z.coerce.number().min(0).max(100).default(0),
    taxPercent: z.coerce.number().min(0).max(100).optional(),
  })
  .refine((line) => Boolean(line.productId?.trim() || line.description?.trim()), {
    // Without this a line is a price attached to nothing, and the person preparing
    // the order has no way of knowing what it was for.
    message: "Pick a product or describe what the line is for",
    path: ["description"],
  });

const createSchema = z.object({
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  quoteId: z.string().optional(),
  dealId: z.string().optional(),
  status: z.enum(["draft", "processing", "completed", "cancelled"]).default("draft"),
  orderDate: z.string().optional(),
  currency: z.string().default("EUR"),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().max(2000).optional(),
  items: z.array(orderItemSchema).min(1, "At least one item is required"),
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
      notes: validated.notes?.trim() || null,
      orderDate: validated.orderDate ? new Date(validated.orderDate) : new Date(),
    })
    .returning();

  await db.insert(orderItems).values(
    validated.items.map((item, i) => {
      const line = totals.lines[i];
      return {
        orderId: order.id,
        // Empty means a free-text line, not a missing product.
        productId: item.productId?.trim() || null,
        description: item.description?.trim() || null,
        notes: item.notes?.trim() || null,
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

  // After the response, like every other module: the writer waits for none of it.
  after(async () => {
    await recordOrderActivity(db, order, `Order ${order.orderNumber} created · ${order.totalAmount} ${order.currency}`);
    await runAutomations({
      entityType: "order",
      entityId: order.id,
      event: "onCreate",
      oldData: {},
      newData: order as Record<string, unknown>,
      currentUserId: actor.userId,
    });
  });

  return order;
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  const actor = await requireCapability("order:write");
  await requirePlanModule("sales");
  const db = await getDb();

  // The state it is leaving, read before it is gone. A rule that fires «when an
  // order moves to completed» cannot tell a move from a re-save without it.
  const [previous] = await db.select().from(orders).where(eq(orders.id, id));
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

    after(async () => {
      if (previous && previous.status !== updated.status) {
        await recordOrderActivity(
          db,
          updated,
          `Order ${updated.orderNumber} moved from ${previous.status} to ${updated.status}`,
        );
      }
      await runAutomations({
        entityType: "order",
        entityId: updated.id,
        event: "onUpdate",
        oldData: (previous ?? {}) as Record<string, unknown>,
        newData: updated as Record<string, unknown>,
        currentUserId: actor.userId,
      });
    });
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
      taxPercent: r.taxPercent == null ? undefined : Number(r.taxPercent),
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

/**
 * Turns an accepted quote into an order, and closes the deal behind it.
 *
 * The three steps all existed and none of them were connected: `converted` was a
 * quote status nothing ever set, `order.quote_id` pointed at a quote nothing ever
 * read, and a won deal had no close date. So the same figures were retyped into a
 * second document by hand, which is both the slowest step in the sales month and
 * the one where the two documents start to disagree (audit rilievi S-03, D-06).
 *
 * The order is a copy, not a view. A quote can be superseded or expire; an order
 * has to keep saying what was actually agreed on the day it was agreed.
 */
export async function convertQuoteToOrderAction(quoteId: string) {
  const actor = await requireCapability("order:write");
  await requirePlanModule("sales");
  const db = await getDb();

  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!quote) throw new Error("Quote not found.");

  if (quote.status === "converted") {
    const [existing] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(eq(orders.quoteId, quoteId));
    // Not an error worth stopping on: the person clicked twice, or someone else
    // got there first. Send them to the order that already exists.
    if (existing) return { success: true, orderId: existing.id, orderNumber: existing.orderNumber };
    throw new Error("This quote is already marked as converted.");
  }

  if (quote.status !== "accepted") {
    throw new Error("Only an accepted quote becomes an order. Record the customer's answer first.");
  }

  const lines = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  if (lines.length === 0) throw new Error("This quote has no lines to order.");

  const orderId = crypto.randomUUID();
  const now = new Date();

  // Copied line by line rather than recomputed: the customer accepted these
  // figures, and a product's price or tax rate may have moved since.
  const itemRows = lines.map((line) => ({
    orderId,
    productId: line.productId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent ?? "0",
    discountAmount: line.discountAmount ?? "0",
    taxPercent: line.taxPercent ?? "0",
    taxAmount: line.taxAmount ?? "0",
    totalPrice: line.totalPrice,
  }));

  const orderNumber = await nextOrderNumber(db);

  // One commit. An order without its lines, or lines without their order, is worse
  // than no order at all. `db.transaction()` throws on the Neon HTTP driver;
  // `db.batch()` maps to its transaction endpoint.
  const writes: unknown[] = [
    db.insert(orders).values({
      id: orderId,
      orderNumber,
      companyId: quote.companyId,
      contactId: quote.contactId,
      ownerId: quote.ownerId ?? actor.userId,
      quoteId: quote.id,
      dealId: quote.dealId,
      status: "draft",
      currency: quote.currency,
      subtotal: quote.subtotal,
      discountPercent: quote.discountPercent ?? "0",
      discountAmount: quote.discountAmount ?? "0",
      taxAmount: quote.taxAmount ?? "0",
      totalAmount: quote.totalAmount,
      orderDate: now,
    }),
    db.insert(orderItems).values(itemRows),
    db.update(quotes).set({ status: "converted", updatedAt: now }).where(eq(quotes.id, quote.id)),
  ];

  // The deal is won the moment the customer's order exists. Leaving it open is how
  // closed business kept weighing on the forecast for ever (rilievo C-06).
  if (quote.dealId) {
    writes.push(
      db
        .update(deals)
        .set({ status: "won", closedAt: now, updatedAt: now })
        .where(and(eq(deals.id, quote.dealId), ne(deals.status, "won"))),
    );
  }

  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);

  dispatchWebhook("order.created", {
    id: orderId,
    orderNumber,
    total: quote.totalAmount,
    currency: quote.currency,
    fromQuoteId: quote.id,
  });

  revalidatePath("/dashboard/sales/quotes");
  revalidatePath(`/dashboard/sales/quotes/${quoteId}`);
  revalidatePath("/dashboard/sales/orders");
  revalidatePath("/dashboard/pipeline");

  // An order that arrived through a quote is still an order arriving: the same
  // trace on the record, the same rules, or half the orders are invisible to both.
  after(async () => {
    const customer = {
      companyId: quote.companyId,
      contactId: quote.contactId,
      dealId: quote.dealId,
      ownerId: quote.ownerId ?? actor.userId,
    };
    await recordOrderActivity(
      db,
      customer,
      `Order ${orderNumber} created from quote ${quote.quoteNumber} · ${quote.totalAmount} ${quote.currency}`,
    );
    await runAutomations({
      entityType: "order",
      entityId: orderId,
      event: "onCreate",
      oldData: {},
      newData: {
        id: orderId,
        orderNumber,
        status: "draft",
        currency: quote.currency,
        totalAmount: quote.totalAmount,
        discountPercent: quote.discountPercent ?? "0",
        quoteId: quote.id,
        ...customer,
      },
      currentUserId: actor.userId,
    });
  });

  return { success: true, orderId, orderNumber };
}

/**
 * Everything the order form needs to fill its selectors, in one round trip.
 *
 * The creation dialog offered a product list and nothing else — no customer, no
 * contact, no link back to the quote or the deal the order came from — so an
 * order created by hand was a set of figures belonging to nobody.
 */
export async function getOrderFormData() {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();

  const [companyList, contactList, productList, dealList, quoteList] = await Promise.all([
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
      .orderBy(contacts.firstName, contacts.lastName),
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        price: products.price,
        taxPercent: products.taxPercent,
        unit: products.unit,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(products.name),
    db
      .select({ id: deals.id, name: deals.name, companyId: deals.companyId, contactId: deals.contactId })
      .from(deals)
      .where(eq(deals.status, "open"))
      .orderBy(desc(deals.createdAt))
      .limit(200),
    // Only quotes the customer has accepted: an order for anything else is a
    // document nobody agreed to.
    db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        companyId: quotes.companyId,
        contactId: quotes.contactId,
        totalAmount: quotes.totalAmount,
      })
      .from(quotes)
      .where(eq(quotes.status, "accepted"))
      .orderBy(desc(quotes.createdAt))
      .limit(200),
  ]);

  return { companies: companyList, contacts: contactList, products: productList, deals: dealList, quotes: quoteList };
}

"use server";

import { getDb } from "@/lib/tenant-context";
import { orders, orderItems, companies, contacts, products, users } from "@/db/schema";
import { eq, desc, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireWriteAccess, requireAdminAccess } from "@/lib/auth-guard";
import { auth } from "@/auth";
import { z } from "zod";
import { getExchangeRates, convertToEur } from "@/lib/exchange-rates";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStatus = "draft" | "processing" | "completed" | "cancelled";

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOrderNumber(): string {
  const now = new Date();
  const y   = now.getFullYear().toString().slice(-2);
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const d   = String(now.getDate()).padStart(2, "0");
  const rnd = Math.floor(Math.random() * 9000) + 1000;
  return `ORD-${y}${m}${d}-${rnd}`;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getOrders(search?: string) {
  const db = await getDb();
  const companyAlias = db.$with("co").as(db.select().from(companies));
  const contactAlias = db.$with("ct").as(db.select().from(contacts));
  const ownerAlias   = db.$with("ow").as(db.select().from(users));

  const rows = await db
    .select({
      id:          orders.id,
      orderNumber: orders.orderNumber,
      status:      orders.status,
      totalAmount: orders.totalAmount,
      orderDate:   orders.orderDate,
      createdAt:   orders.createdAt,
      companyId:   orders.companyId,
      contactId:   orders.contactId,
      ownerId:     orders.ownerId,
      companyName: companies.name,
      contactFirstName: contacts.firstName,
      contactLastName:  contacts.lastName,
      contactEmail:     contacts.email,
      ownerName:   users.name,
    })
    .from(orders)
    .leftJoin(companies, eq(orders.companyId, companies.id))
    .leftJoin(contacts,  eq(orders.contactId,  contacts.id))
    .leftJoin(users,     eq(orders.ownerId,     users.id))
    .where(
      search
        ? or(
            ilike(orders.orderNumber, `%${search}%`),
            ilike(companies.name,    `%${search}%`),
          )
        : undefined,
    )
    .orderBy(desc(orders.createdAt));

  return rows;
}

export async function getOrderById(id: string) {
  const db = await getDb();
  const [order] = await db
    .select({
      id:          orders.id,
      orderNumber: orders.orderNumber,
      status:      orders.status,
      totalAmount: orders.totalAmount,
      orderDate:   orders.orderDate,
      createdAt:   orders.createdAt,
      updatedAt:   orders.updatedAt,
      companyId:   orders.companyId,
      contactId:   orders.contactId,
      opportunityId: orders.opportunityId,
      ownerId:     orders.ownerId,
      companyName: companies.name,
      contactFirstName: contacts.firstName,
      contactLastName:  contacts.lastName,
      contactEmail:     contacts.email,
      ownerName:   users.name,
    })
    .from(orders)
    .leftJoin(companies, eq(orders.companyId, companies.id))
    .leftJoin(contacts,  eq(orders.contactId,  contacts.id))
    .leftJoin(users,     eq(orders.ownerId,     users.id))
    .where(eq(orders.id, id));

  if (!order) return null;

  const items = await db
    .select({
      id:         orderItems.id,
      orderId:    orderItems.orderId,
      productId:  orderItems.productId,
      quantity:   orderItems.quantity,
      unitPrice:  orderItems.unitPrice,
      totalPrice: orderItems.totalPrice,
      productName: products.name,
      productSku:  products.sku,
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
      total:     sql<number>`count(*)::int`,
      draft:     sql<number>`count(*) filter (where ${orders.status} = 'draft')::int`,
      processing: sql<number>`count(*) filter (where ${orders.status} = 'processing')::int`,
      completed: sql<number>`count(*) filter (where ${orders.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} = 'cancelled')::int`,
      revenue:   sql<number>`coalesce(sum(case when ${orders.status} = 'completed' then cast(${orders.totalAmount} as numeric) end), 0)`,
    })
    .from(orders);
  return counts;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

const createSchema = z.object({
  companyId:    z.string().optional(),
  contactId:    z.string().optional(),
  status:       z.enum(["draft", "processing", "completed", "cancelled"]).default("draft"),
  orderDate:    z.string().optional(),
  currency:     z.string().default("EUR"),
  items: z.array(z.object({
    productId:  z.string().min(1),
    quantity:   z.coerce.number().int().min(1),
    unitPrice:  z.coerce.number().min(0),
  })).min(1, "At least one item is required"),
});

export async function createOrder(data: z.infer<typeof createSchema>) {
  await requireWriteAccess();
  const db = await getDb();
  const session = await auth();
  const validated = createSchema.parse(data);

  const inputCurrency = (validated.currency || "EUR").toUpperCase();
  let conversionRate = 1;
  if (inputCurrency !== "EUR") {
    const { rates } = await getExchangeRates();
    const rate = rates[inputCurrency.toLowerCase()];
    if (rate) conversionRate = 1 / rate;
  }

  // All monetary amounts are stored in EUR
  const toEur = (amount: number) => amount * conversionRate;

  const totalAmount = validated.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );

  const [order] = await db
    .insert(orders)
    .values({
      orderNumber: generateOrderNumber(),
      companyId:   validated.companyId || null,
      contactId:   validated.contactId || null,
      ownerId:     session?.user?.id ?? null,
      status:      validated.status,
      totalAmount: String(toEur(totalAmount)),
      orderDate:   validated.orderDate ? new Date(validated.orderDate) : new Date(),
    })
    .returning();

  await db.insert(orderItems).values(
    validated.items.map((item) => ({
      orderId:    order.id,
      productId:  item.productId,
      quantity:   item.quantity,
      unitPrice:  String(toEur(item.unitPrice)),
      totalPrice: String(toEur(item.quantity * item.unitPrice)),
    })),
  );

  revalidatePath("/dashboard/orders");
  return order;
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  await requireWriteAccess();
  const db = await getDb();
  await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id));
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
}

export async function addOrderItem(
  orderId: string,
  item: { productId: string; quantity: number; unitPrice: number },
) {
  await requireWriteAccess();
  const db = await getDb();
  await db.insert(orderItems).values({
    orderId,
    productId:  item.productId,
    quantity:   item.quantity,
    unitPrice:  String(item.unitPrice),
    totalPrice: String(item.quantity * item.unitPrice),
  });

  // Recalculate total
  const allItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const total = allItems.reduce((s, i) => s + Number(i.totalPrice), 0);
  await db.update(orders).set({ totalAmount: String(total), updatedAt: new Date() }).where(eq(orders.id, orderId));
  revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function removeOrderItem(itemId: string, orderId: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(orderItems).where(eq(orderItems.id, itemId));

  const allItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const total = allItems.reduce((s, i) => s + Number(i.totalPrice), 0);
  await db.update(orders).set({ totalAmount: String(total), updatedAt: new Date() }).where(eq(orders.id, orderId));
  revalidatePath(`/dashboard/orders/${orderId}`);
}

export async function deleteOrder(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(orders).where(eq(orders.id, id));
  revalidatePath("/dashboard/orders");
}

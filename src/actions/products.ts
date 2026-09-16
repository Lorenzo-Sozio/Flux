"use server";

import { revalidatePath } from "next/cache";

import { and, asc, count, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { products } from "@/db/schema";
import { requireCapability, requirePlanModule, requireWriteAccess } from "@/lib/auth-guard";
import { type ListParams, offsetOf, toPage } from "@/lib/pagination";
import { getDb } from "@/lib/tenant-context";

// ── Schema ────────────────────────────────────────────────────────────────────

const productSchema = z.object({
  name: z.string().min(1, "validation.products.nameRequired"),
  description: z.string().optional(),
  sku: z.string().optional(),
  price: z.coerce.number().min(0, "validation.products.priceNegative"),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  unit: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

// ── Queries ───────────────────────────────────────────────────────────────────

/** The columns the catalogue may be sorted by, and nothing else. */
const PRODUCT_SORTS = {
  name: products.name,
  sku: products.sku,
  price: products.price,
  category: products.category,
  createdAt: products.createdAt,
} as const;

/**
 * One page of the catalogue, with the total that matches the query.
 *
 * ⚠️ Replaces `getProducts`, which selected every column of every product a
 * workspace had ever sold and let the browser do the searching. A catalogue is
 * the one table that grows without anybody deciding to grow it: a supplier's
 * price list imported once is ten thousand rows, and every visit to this screen
 * carried all of them so somebody could look at fifty.
 */
export async function listProducts(params: ListParams, filter?: string) {
  await requireCapability("record:read");
  const db = await getDb();

  const term = params.search.trim();
  const clauses: (SQL | undefined)[] = [
    filter === "active"
      ? eq(products.isActive, true)
      : filter === "inactive"
        ? eq(products.isActive, false)
        : undefined,
    term
      ? or(ilike(products.name, `%${term}%`), ilike(products.sku, `%${term}%`), ilike(products.category, `%${term}%`))
      : undefined,
  ];
  const kept = clauses.filter(Boolean) as SQL[];
  const where = kept.length ? and(...kept) : undefined;

  const sortCol = params.sort ? PRODUCT_SORTS[params.sort as keyof typeof PRODUCT_SORTS] : undefined;
  const order = sortCol ? (params.dir === "asc" ? asc(sortCol) : desc(sortCol)) : desc(products.createdAt);

  const [rows, [counted]] = await Promise.all([
    db.select().from(products).where(where).orderBy(order).limit(params.pageSize).offset(offsetOf(params)),
    db.select({ n: count() }).from(products).where(where),
  ]);

  return toPage(rows, Number(counted?.n ?? 0), params);
}

/**
 * The three figures above the catalogue, counted over the whole workspace.
 *
 * They doubled as the filter buttons and were computed from the rows on screen,
 * so with paging they would have described the page rather than the catalogue —
 * and a button labelled "inactive 3" that reveals two hundred is worse than no
 * button.
 */
export async function getProductStats() {
  await requireCapability("record:read");
  const db = await getDb();
  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${products.isActive})`,
    })
    .from(products);
  const total = Number(row?.total ?? 0);
  const active = Number(row?.active ?? 0);
  return { total, active, inactive: total - active };
}

/**
 * The catalogue as a picker feeds on it: active products, six columns, by name.
 *
 * ⚠️ Deliberately not paged, and deliberately not the same query as the list. A
 * `<Select>` on an order line has to be able to reach every product that can be
 * sold, so a page of fifty would be a product somebody cannot add to an order.
 * What it does drop is everything a picker has no use for: the inactive rows,
 * the description, and the timestamps. Follows `getContactsForSelect` and
 * `getCompaniesForSelect`, for the same reason and in the same shape.
 */
export async function getProductsForSelect() {
  await requireCapability("record:read");
  const db = await getDb();
  return db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      price: products.price,
      taxPercent: products.taxPercent,
      unit: products.unit,
      isActive: products.isActive,
    })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(products.name);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createProduct(data: z.infer<typeof productSchema>) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  const validated = productSchema.parse(data);
  const [product] = await db
    .insert(products)
    .values({
      name: validated.name,
      description: validated.description,
      sku: validated.sku,
      price: String(validated.price),
      taxPercent: String(validated.taxPercent),
      unit: validated.unit ?? null,
      category: validated.category ?? null,
      isActive: validated.isActive,
    })
    .returning();
  revalidatePath("/dashboard/sales/products");
  return product;
}

export async function updateProduct(id: string, data: Partial<z.infer<typeof productSchema>>) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  const [product] = await db
    .update(products)
    .set({
      ...data,
      price: data.price !== undefined ? String(data.price) : undefined,
      taxPercent: data.taxPercent !== undefined ? String(data.taxPercent) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(products.id, id))
    .returning();
  revalidatePath("/dashboard/sales/products");
  return product;
}

export async function toggleProductActive(id: string, isActive: boolean) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  await db.update(products).set({ isActive, updatedAt: new Date() }).where(eq(products.id, id));
  revalidatePath("/dashboard/sales/products");
}

export async function deleteProduct(id: string) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  await db.delete(products).where(eq(products.id, id));
  revalidatePath("/dashboard/sales/products");
}

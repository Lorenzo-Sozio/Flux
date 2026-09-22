"use server";

import { revalidatePath } from "next/cache";

import { and, asc, count, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { companies, priceListItems, priceLists, products } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { type ListParams, offsetOf, toPage } from "@/lib/pagination";
import { MAX_ADJUSTMENT, MIN_ADJUSTMENT, type PriceRules } from "@/lib/price-list";
import { getDb } from "@/lib/tenant-context";

/**
 * Price lists: what a group of customers pays, instead of what the catalogue says.
 *
 * Reading one needs no more authority than reading the products behind it; changing one
 * is `product:manage` (admin), because a price list is a commercial decision that
 * applies to every quote written from then on.
 */

const priceListSchema = z.object({
  name: z.string().trim().min(1, "validation.priceLists.nameRequired").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  adjustmentPercent: z.coerce
    .number()
    .min(MIN_ADJUSTMENT, "validation.priceLists.adjustmentRange")
    .max(MAX_ADJUSTMENT, "validation.priceLists.adjustmentRange"),
  isActive: z.boolean().default(true),
});

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * One page of lists, each with how many prices it names and how many customers it is
 * assigned to — the two figures that say whether a list is really in use, counted in
 * the same statement rather than per row.
 */
export async function listPriceLists(params: ListParams, filter?: string) {
  await requireCapability("record:read");
  const db = await getDb();

  const term = params.search.trim();
  const clauses: (SQL | undefined)[] = [
    filter === "active"
      ? eq(priceLists.isActive, true)
      : filter === "inactive"
        ? eq(priceLists.isActive, false)
        : undefined,
    term ? or(ilike(priceLists.name, `%${term}%`), ilike(priceLists.description, `%${term}%`)) : undefined,
  ];
  const where = clauses.filter(Boolean).length ? sql.join(clauses.filter(Boolean) as SQL[], sql` and `) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: priceLists.id,
        name: priceLists.name,
        description: priceLists.description,
        adjustmentPercent: priceLists.adjustmentPercent,
        isActive: priceLists.isActive,
        updatedAt: priceLists.updatedAt,
        // ⚠️⚠️ Written out with the table names, not as `${priceListItems.priceListId}`.
        // Drizzle renders a column inside a raw fragment **unqualified**, so the
        // subquery became `where "price_list_id" = "id"` — and inside it both names
        // resolve to the subquery's own table. Every list then counted zero prices and
        // zero customers, which reads exactly like a list nobody uses.
        priceCount: sql<number>`(select count(*) from "price_list_item" where "price_list_item"."price_list_id" = "price_list"."id")`,
        companyCount: sql<number>`(select count(*) from "company" where "company"."price_list_id" = "price_list"."id")`,
      })
      .from(priceLists)
      .where(where)
      .orderBy(asc(priceLists.name))
      .limit(params.pageSize)
      .offset(offsetOf(params)),
    db.select({ value: count() }).from(priceLists).where(where),
  ]);

  return toPage(rows, Number(total?.value ?? 0), params);
}

/** One list with the prices it names, for its own page. */
export async function getPriceList(id: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const [list] = await db.select().from(priceLists).where(eq(priceLists.id, id));
  if (!list) return null;

  const items = await db
    .select({
      id: priceListItems.id,
      productId: priceListItems.productId,
      unitPrice: priceListItems.unitPrice,
      productName: products.name,
      productSku: products.sku,
      basePrice: products.price,
      isActive: products.isActive,
    })
    .from(priceListItems)
    .innerJoin(products, eq(products.id, priceListItems.productId))
    .where(eq(priceListItems.priceListId, id))
    .orderBy(asc(products.name));

  const [used] = await db.select({ value: count() }).from(companies).where(eq(companies.priceListId, id));

  return { list, items, companyCount: Number(used?.value ?? 0) };
}

/**
 * The lists a customer or a document can be put on. Active only, like the product picker.
 *
 * ⚠️ `keepId` is the list a record is *already* on. A retired list is not offered to
 * anybody new, but leaving it out of the options of the record that still points at it
 * showed that customer an empty select — a screen saying "no price list" about a
 * customer who has one, and one save away from making that true.
 */
export async function getPriceListsForSelect(keepId?: string | null) {
  await requireCapability("record:read");
  const db = await getDb();
  return db
    .select({
      id: priceLists.id,
      name: priceLists.name,
      adjustmentPercent: priceLists.adjustmentPercent,
      isActive: priceLists.isActive,
    })
    .from(priceLists)
    .where(keepId ? or(eq(priceLists.isActive, true), eq(priceLists.id, keepId)) : eq(priceLists.isActive, true))
    .orderBy(asc(priceLists.name));
}

/**
 * What a form needs to price a line: the percentage and the prices that beat it.
 *
 * ⚠️ Fetched per list rather than sent with the whole catalogue, because the customer
 * on a quote can change after the lines exist — and because a workspace that imported a
 * supplier's list has thousands of prices that no screen should carry until it needs them.
 *
 * Nothing comes back for a list that has been turned off: the price of the catalogue is
 * what a customer on a retired list pays.
 */
export async function getPriceRules(id: string): Promise<PriceRules | null> {
  await requireCapability("record:read");
  const db = await getDb();
  const [list] = await db
    .select({
      id: priceLists.id,
      name: priceLists.name,
      adjustmentPercent: priceLists.adjustmentPercent,
      isActive: priceLists.isActive,
    })
    .from(priceLists)
    .where(eq(priceLists.id, id));
  // ⚠️⚠️ A retired list prices nothing. Without this, turning a list off stopped it
  // being offered to new customers and went on quoting the customers already on it —
  // which is the one thing switching it off was meant to stop, and nothing said so.
  if (!list || !list.isActive) return null;

  const items = await db
    .select({ productId: priceListItems.productId, unitPrice: priceListItems.unitPrice })
    .from(priceListItems)
    .where(eq(priceListItems.priceListId, id));

  const overrides: Record<string, number> = {};
  for (const item of items) overrides[item.productId] = Number(item.unitPrice);
  return { id: list.id, name: list.name, adjustmentPercent: Number(list.adjustmentPercent), overrides };
}

/** The list a customer is on, for a form that starts from the company. */
export async function getCompanyPriceRules(companyId: string): Promise<PriceRules | null> {
  await requireCapability("record:read");
  const db = await getDb();
  const [company] = await db
    .select({ priceListId: companies.priceListId })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company?.priceListId) return null;
  return getPriceRules(company.priceListId);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createPriceList(data: z.infer<typeof priceListSchema>) {
  await requireCapability("product:manage");
  await requirePlanModule("sales");
  const db = await getDb();
  const v = priceListSchema.parse(data);
  const [created] = await db
    .insert(priceLists)
    .values({
      name: v.name,
      description: v.description ?? null,
      adjustmentPercent: String(v.adjustmentPercent),
      isActive: v.isActive,
    })
    .returning();
  revalidatePath("/dashboard/sales/price-lists");
  return created;
}

export async function updatePriceList(id: string, data: Partial<z.infer<typeof priceListSchema>>) {
  await requireCapability("product:manage");
  await requirePlanModule("sales");
  const db = await getDb();
  const v = priceListSchema.partial().parse(data);
  const [updated] = await db
    .update(priceLists)
    .set({
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.description !== undefined ? { description: v.description ?? null } : {}),
      ...(v.adjustmentPercent !== undefined ? { adjustmentPercent: String(v.adjustmentPercent) } : {}),
      ...(v.isActive !== undefined ? { isActive: v.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(priceLists.id, id))
    .returning();
  revalidatePath("/dashboard/sales/price-lists");
  revalidatePath(`/dashboard/sales/price-lists/${id}`);
  return updated;
}

/**
 * Deletes a list. The customers on it keep existing and go back to catalogue prices —
 * that is the foreign key's `set null`, not something this has to remember — and the
 * prices it named go with it.
 *
 * ⚠️ Documents already written keep the figures they were written with: a quote stores
 * its own unit prices, and none of this reaches back into one.
 */
export async function deletePriceList(id: string) {
  await requireCapability("product:manage");
  await requirePlanModule("sales");
  const db = await getDb();
  await db.delete(priceLists).where(eq(priceLists.id, id));
  revalidatePath("/dashboard/sales/price-lists");
}

/**
 * Sets one product's price in a list.
 *
 * ⚠️ One statement, so two people setting the same price at once leave one row rather
 * than a duplicate the unique index would have to refuse: the conflict is the update.
 */
export async function setPriceListItem(priceListId: string, productId: string, unitPrice: number) {
  await requireCapability("product:manage");
  await requirePlanModule("sales");
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("validation.priceLists.priceNegative");
  const db = await getDb();
  await db
    .insert(priceListItems)
    .values({ priceListId, productId, unitPrice: String(unitPrice) })
    .onConflictDoUpdate({
      target: [priceListItems.priceListId, priceListItems.productId],
      set: { unitPrice: String(unitPrice), updatedAt: new Date() },
    });
  revalidatePath(`/dashboard/sales/price-lists/${priceListId}`);
}

export async function removePriceListItem(priceListId: string, productId: string) {
  await requireCapability("product:manage");
  await requirePlanModule("sales");
  const db = await getDb();
  await db
    .delete(priceListItems)
    // Built rather than written out: a raw fragment renders these columns unqualified,
    // which is harmless in a single-table delete and a defect the moment anyone adds a join.
    .where(and(eq(priceListItems.priceListId, priceListId), eq(priceListItems.productId, productId)));
  revalidatePath(`/dashboard/sales/price-lists/${priceListId}`);
}

/** Puts customers on a list, or takes them off it, from the list's own page. */
export async function assignPriceList(companyIds: string[], priceListId: string | null) {
  await requireCapability("product:manage");
  await requirePlanModule("sales");
  if (companyIds.length === 0) return;
  const db = await getDb();
  await db
    .update(companies)
    .set({ priceListId, updatedAt: new Date() })
    .where(inArray(companies.id, companyIds.slice(0, 500)));
  revalidatePath("/dashboard/companies");
  if (priceListId) revalidatePath(`/dashboard/sales/price-lists/${priceListId}`);
}

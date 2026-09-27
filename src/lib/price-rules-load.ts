/**
 * Loading a price list's rules from a given database (the pricing itself is src/lib/price-list.ts).
 *
 * Here rather than in the actions because the API prices for an integration with no session:
 * the dashboard's actions and `/api/crm/products` must read the same list the same way, or the
 * assistant quotes one price and the salesperson's form another.
 */
import { eq } from "drizzle-orm";

import { companies, priceListItems, priceLists } from "@/db/schema";
import type { PriceRules } from "@/lib/price-list";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/**
 * The rules of one list, or null for a list that does not exist or has been turned off.
 *
 * ⚠️⚠️ A retired list prices nothing. Without this, turning a list off stopped it being
 * offered to new customers and went on quoting the customers already on it — which is the
 * one thing switching it off was meant to stop, and nothing said so.
 */
export async function loadPriceRules(db: AnyDb, id: string): Promise<PriceRules | null> {
  const [list] = await db
    .select({
      id: priceLists.id,
      name: priceLists.name,
      adjustmentPercent: priceLists.adjustmentPercent,
      isActive: priceLists.isActive,
    })
    .from(priceLists)
    .where(eq(priceLists.id, id));
  if (!list || !list.isActive) return null;

  const items = await db
    .select({ productId: priceListItems.productId, unitPrice: priceListItems.unitPrice })
    .from(priceListItems)
    .where(eq(priceListItems.priceListId, id));

  const overrides: Record<string, number> = {};
  for (const item of items) overrides[item.productId] = Number(item.unitPrice);
  return { id: list.id, name: list.name, adjustmentPercent: Number(list.adjustmentPercent), overrides };
}

/** The rules of the list a company is on; null for no list, or a retired one. */
export async function loadCompanyPriceRules(db: AnyDb, companyId: string): Promise<PriceRules | null> {
  const [company] = await db
    .select({ priceListId: companies.priceListId })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company?.priceListId) return null;
  return loadPriceRules(db, company.priceListId);
}

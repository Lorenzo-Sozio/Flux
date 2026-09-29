import { sql } from "drizzle-orm";

import { rowsOf } from "@/lib/db-together";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/**
 * The customers among `ids` that have accounts with us: an issued invoice or money received.
 *
 * ⚠️⚠️ Such a customer is merged, never deleted. Deleting one set `company_id` to null on its
 * invoices and receipts: a credit note of its invoice could no longer be issued ("customer
 * missing"), its credit belonged to nobody and could not be spent, its statement of account was
 * gone, and what it owed stayed in the receivables with no name.
 */
export async function companiesWithAccounts(db: AnyDb, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const list = JSON.stringify([...ids]);
  const result = await db.execute(sql`
    select c.id from company c
    where c.id in (select jsonb_array_elements_text(${list}::jsonb))
      and (exists (select 1 from invoice i where i.company_id = c.id and i.status = 'issued')
        or exists (select 1 from receipt r where r.company_id = c.id))`);
  return new Set(rowsOf<{ id: string }>(result).map((r) => r.id));
}

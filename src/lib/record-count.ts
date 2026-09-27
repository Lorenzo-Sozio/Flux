import { count } from "drizzle-orm";

import { companies, contacts, deals, leads } from "@/db/schema";
import type { getDb } from "@/lib/tenant-context";

/**
 * How many records the workspace holds, as the `maxRecords` plan limit counts them:
 * contacts, leads, companies and deals together.
 *
 * One definition. It was written out in the lead, contact and company actions and again
 * in the deal action, and a limit counted two ways is a limit that lets one door through.
 */
export async function countRecords(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  const [[c], [l], [co], [d]] = await Promise.all([
    db.select({ n: count() }).from(contacts),
    db.select({ n: count() }).from(leads),
    db.select({ n: count() }).from(companies),
    db.select({ n: count() }).from(deals),
  ]);
  return Number(c?.n ?? 0) + Number(l?.n ?? 0) + Number(co?.n ?? 0) + Number(d?.n ?? 0);
}

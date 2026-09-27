/**
 * How much of the plan's storage a workspace is using: documents on records AND
 * files sent in the chat.
 *
 * ⚠️ One figure for every upload's quota check. With the chat counted nowhere, a
 * workspace could fill the bucket through the chat while the document upload still
 * reported room to spare — the limit being paid for would not have been a limit.
 * Counted from the rows, as before: the rows are what the customer can reach.
 */
import { sql } from "drizzle-orm";

import { dmAttachments, documents } from "@/db/schema";

// biome-ignore lint/suspicious/noExplicitAny: a tenant handle from getDb
type Db = any;

export async function storageBytesUsed(db: Db): Promise<number> {
  const [docs] = await db.select({ bytes: sql<number>`coalesce(sum(${documents.size}), 0)::bigint` }).from(documents);
  const [chat] = await db
    .select({ bytes: sql<number>`coalesce(sum(${dmAttachments.size}), 0)::bigint` })
    .from(dmAttachments);
  return Number(docs?.bytes ?? 0) + Number(chat?.bytes ?? 0);
}

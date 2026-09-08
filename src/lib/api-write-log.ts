import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { apiWriteLog } from "@/db/schema";
import type * as tenantSchema from "@/db/schema-tenant";
import type { ApiAuthResult } from "@/lib/api-import-auth";

type TenantDb = NeonHttpDatabase<typeof tenantSchema>;

/**
 * Write down that something was written through the API, and by whom.
 *
 * ## Why this exists, and why it is not a column
 *
 * `authenticateApiRequest` already knows — it returns `via: "session" | "apikey"` on every
 * request — and nothing kept it. So *what has the assistant been doing in my CRM*, which is
 * the question somebody asks before trusting an agent that writes into it, had no answer.
 *
 * ⚠️⚠️ **And `source` is not that answer.** On lead, contact and company it means *where the
 * customer came from*, and the engine already writes the channel into it. Reading
 * provenance out of that column puts two questions in one field, and the first caller to
 * use it for its real meaning makes the report lie.
 *
 * A column of our own on each table would have been worse in a different way: a guarantee
 * that twenty-two routes each have to remember, and the twenty-third would not. The fact
 * lives in one table, the routes call one function, and a test reads the sources to check
 * that they all still do.
 *
 * ## ⚠️ Called after the write, never before
 *
 * Recording the attempt would count a rejected batch among the things an integration
 * achieved — and a report that inflates what an automation did is the one kind of error
 * nobody in the company catches, because it flatters the thing being measured.
 *
 * ## ⚠️⚠️ It never throws, and never fails the request
 *
 * Whoever calls this has already written the customer's data. A log line that could turn a
 * successful import into a 500 would make the product worse in exchange for a report. When
 * it cannot be written the line is lost and the write stands.
 */
export interface ScritturaRegistrata {
  /** What was written, in the CRM's own words: `lead`, `contact`, `note`, `order`… */
  entity: string;
  /** The route that wrote it: two routes write the same thing, and telling them apart is the difference between diagnosing an integration and guessing at it. */
  endpoint: string;
  /** The single record, when there was one. Omitted for a bulk request: naming one row of five hundred would be arbitrary. */
  recordId?: string | null;
  /** How many rows. One request, one line — this carries the size. */
  rows?: number;
}

export async function logApiWrite(
  db: TenantDb,
  auth: Pick<ApiAuthResult, "via" | "userId">,
  scrittura: ScritturaRegistrata,
): Promise<void> {
  // ⚠️ Zero rows is not a write. An import in which every row was rejected is not something
  // the integration did, and listing it among the things it did would inflate the report
  // exactly where the report must not be flattering.
  const rows = scrittura.rows ?? 1;
  if (rows <= 0) return;
  try {
    await db.insert(apiWriteLog).values({
      entity: scrittura.entity,
      endpoint: scrittura.endpoint,
      recordId: scrittura.recordId ?? null,
      rows,
      via: auth.via,
      // A person has a user; an integration has none, and null says that rather than
      // inventing a name for it.
      actor: auth.via === "session" ? auth.userId : null,
    });
  } catch (e) {
    console.error("[api-write-log] not recorded", e);
  }
}

import { and, eq, gte, lte } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { tasks } from "@/db/schema";

/**
 * tasks-due.ts — the tasks-due-today query, where both callers can reach it.
 *
 * The screens ask through a guarded server action; the reminder job asks with the
 * tenant database `runCronJob` hands it, and has no session to be guarded
 * against. Those two needs pulled the old action in opposite directions: adding
 * a guard broke the job, and leaving it off left an endpoint anyone could call.
 *
 * Taking the query out of the action settles it. The action guards and delegates;
 * the job calls this directly. Neither has to compromise, and there is still one
 * definition of what "due today" means.
 */

// biome-ignore lint/suspicious/noExplicitAny: the schema generic is irrelevant to one select
type AnyDb = NeonHttpDatabase<any>;

export async function selectTasksDueToday(db: AnyDb) {
  // Local midnight to local midnight, which is what someone means by "today".
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      status: tasks.status,
      ownerId: tasks.ownerId,
      assigneeId: tasks.assigneeId,
      leadId: tasks.leadId,
      contactId: tasks.contactId,
      companyId: tasks.companyId,
    })
    .from(tasks)
    .where(and(eq(tasks.status, "todo"), gte(tasks.dueDate, start), lte(tasks.dueDate, end)));
}

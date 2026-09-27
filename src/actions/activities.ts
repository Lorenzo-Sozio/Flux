"use server";

import { revalidatePath } from "next/cache";

import { desc, eq } from "drizzle-orm";

import { activities, tasks, users } from "@/db/schema";
import { requireCapability, requireWriteAccess } from "@/lib/auth-guard";
import { activityTypeFor, outcomeFor, taskTypeOf } from "@/lib/task-kinds";
import { getDb } from "@/lib/tenant-context";

export async function createActivity(data: {
  type: string;
  content?: string;
  date?: Date;
  ownerId?: string;
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}) {
  await requireWriteAccess();
  const db = await getDb();
  const result = await db.insert(activities).values(data).returning();
  if (data.leadId) revalidatePath(`/dashboard/leads/${data.leadId}`);
  if (data.contactId) revalidatePath(`/dashboard/contacts/${data.contactId}`);
  if (data.companyId) revalidatePath(`/dashboard/companies/${data.companyId}`);
  if (data.dealId) revalidatePath(`/dashboard/pipeline`);

  // ⚠️⚠️ Logging an activity never writes to the customer. A call used to send the
  // contact an email whose topic was the activity's content — and the timeline form
  // stamps every entry with "now", so every call logged with a note mailed that note,
  // internal remarks included, to the person it was about. What a salesperson writes
  // here is for colleagues. Inviting a customer is an appointment, which says so on
  // the screen and carries an iCalendar invitation (see src/actions/appointments.ts).
  return result[0];
}

export async function getActivitiesByLead(leadId: string) {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      outcome: activities.outcome,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.leadId, leadId))
    .orderBy(desc(activities.createdAt));
}

export async function getActivitiesByContact(contactId: string) {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      outcome: activities.outcome,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.contactId, contactId))
    .orderBy(desc(activities.createdAt));
}

export async function getActivitiesByDeal(dealId: string) {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      outcome: activities.outcome,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
      // Carried for the minutes (rilievo S-06): how long it ran and who was in
      // the room are the two things a meeting record has that a note does not.
      durationMinutes: activities.durationMinutes,
      participants: activities.participants,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.dealId, dealId))
    .orderBy(desc(activities.createdAt));
}

export async function getActivitiesByCompany(companyId: string) {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      outcome: activities.outcome,
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(activities.ownerId, users.id))
    .where(eq(activities.companyId, companyId))
    .orderBy(desc(activities.createdAt));
}

export async function updateActivity(
  id: string,
  data: Partial<typeof activities.$inferInsert>,
  revalidatePathStr?: string,
) {
  await requireWriteAccess();
  const db = await getDb();
  const result = await db.update(activities).set(data).where(eq(activities.id, id)).returning();
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  return result[0];
}

export async function deleteActivity(id: string, revalidatePathStr?: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(activities).where(eq(activities.id, id));
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
}

const CONTACT_TARGETS = { deal: "dealId", lead: "leadId", company: "companyId", contact: "contactId" } as const;

/**
 * A contact logged from the work queue: what kind, how it went, what was said, and the next
 * step if there is one — the same answer "How did it go?" gives for a task, for a contact
 * that had no task behind it.
 */
export async function logContactAction(input: {
  target: { entity: keyof typeof CONTACT_TARGETS; id: string };
  type: string;
  outcome?: string | null;
  note?: string | null;
  next?: { type?: string; title: string; dueDate?: Date | null; allDay?: boolean } | null;
}): Promise<void> {
  const actor = await requireWriteAccess();
  const column = CONTACT_TARGETS[input.target.entity];
  if (!column || !input.target.id) throw new Error("Invalid record.");
  const db = await getDb();
  const kind = taskTypeOf(input.type);
  const link = { [column]: input.target.id };
  const note = input.note?.trim();
  await db.insert(activities).values({
    type: activityTypeFor(kind),
    content: note || null,
    outcome: outcomeFor(kind, input.outcome),
    date: new Date(),
    ownerId: actor.user.id,
    ...link,
  });
  const title = input.next?.title?.trim();
  if (title) {
    await db.insert(tasks).values({
      title,
      type: taskTypeOf(input.next?.type),
      dueDate: input.next?.dueDate ?? null,
      allDay: input.next?.allDay ?? true,
      ownerId: actor.user.id,
      assigneeId: actor.user.id,
      ...link,
    });
  }
  const base = { deal: "pipeline", lead: "leads", company: "companies", contact: "contacts" }[input.target.entity];
  revalidatePath(`/dashboard/${base}/${input.target.id}`);
  revalidatePath("/dashboard/crm");
}

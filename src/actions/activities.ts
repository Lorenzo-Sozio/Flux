"use server";

import { revalidatePath } from "next/cache";

import { and, desc, eq, gte, isNotNull, lte, or } from "drizzle-orm";

import { activities, contacts, leads, users } from "@/db/schema";
import { requireCapability, requireWriteAccess } from "@/lib/auth-guard";
import { sendCallInviteEmail } from "@/lib/email";
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

  // For call activities with a linked contact or lead, send them an email invite
  if (data.type === "call" && data.date && data.content) {
    if (data.contactId) {
      const [contact] = await db
        .select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts)
        .where(eq(contacts.id, data.contactId));
      if (contact?.email) {
        const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "there";
        sendCallInviteEmail(contact.email, name, data.content, data.date).catch(() => {
          // The activity is recorded either way; a failed courtesy email is not
          // a reason to fail the thing the user asked for.
        });
      }
    } else if (data.leadId) {
      const [lead] = await db
        .select({ email: leads.email, firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(eq(leads.id, data.leadId));
      if (lead?.email) {
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "there";
        sendCallInviteEmail(lead.email, name, data.content, data.date).catch(() => {
          // See above: the invitation is a courtesy, the record is the point.
        });
      }
    }
  }

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
      date: activities.date,
      createdAt: activities.createdAt,
      ownerName: users.name,
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

// Returns call/meeting activities scheduled for today (for cron day-of reminders)
export async function getActivitiesDueToday() {
  const db = await getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      ownerId: activities.ownerId,
      contactId: activities.contactId,
      leadId: activities.leadId,
      companyId: activities.companyId,
    })
    .from(activities)
    .where(
      and(
        isNotNull(activities.date),
        gte(activities.date, start),
        lte(activities.date, end),
        or(eq(activities.type, "call"), eq(activities.type, "meeting")),
      ),
    );
}

/**
 * Returns activities whose reminder should fire within the next `windowMinutes`.
 * Called by the cron worker every minute: finds activities where
 *   (date - reminderMinutes) is between now and now+windowMinutes.
 */
export async function getActivitiesWithPendingReminder(windowMinutes = 2) {
  const db = await getDb();
  const now = new Date();
  const ahead = new Date(now.getTime() + windowMinutes * 60_000);

  return await db
    .select({
      id: activities.id,
      type: activities.type,
      content: activities.content,
      date: activities.date,
      reminderMinutes: activities.reminderMinutes,
      ownerId: activities.ownerId,
      contactId: activities.contactId,
      leadId: activities.leadId,
      companyId: activities.companyId,
    })
    .from(activities)
    .where(and(isNotNull(activities.date), isNotNull(activities.reminderMinutes)))
    // Filter in JS: date - reminderMinutes is in [now, ahead]
    .then((rows) =>
      rows.filter((r) => {
        if (!r.date || r.reminderMinutes == null) return false;
        const fireAt = new Date(r.date.getTime() - r.reminderMinutes * 60_000);
        return fireAt >= now && fireAt <= ahead;
      }),
    );
}

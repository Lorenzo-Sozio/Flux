"use server";

import { db } from "@/db";
import { activities, contacts, leads, users } from "@/db/schema";
import { eq, desc, and, gte, lte, or, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sendCallInviteEmail } from "@/lib/email";
import { requireWriteAccess } from "@/lib/auth-guard";

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
        sendCallInviteEmail(contact.email, name, data.content, data.date).catch(() => {});
      }
    } else if (data.leadId) {
      const [lead] = await db
        .select({ email: leads.email, firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(eq(leads.id, data.leadId));
      if (lead?.email) {
        const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "there";
        sendCallInviteEmail(lead.email, name, data.content, data.date).catch(() => {});
      }
    }
  }

  return result[0];
}

export async function getActivitiesByLead(leadId: string) {
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

export async function updateActivity(id: string, data: Partial<typeof activities.$inferInsert>, revalidatePathStr?: string) {
  await requireWriteAccess();
  const result = await db.update(activities).set(data).where(eq(activities.id, id)).returning();
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
  return result[0];
}

export async function deleteActivity(id: string, revalidatePathStr?: string) {
  await requireWriteAccess();
  await db.delete(activities).where(eq(activities.id, id));
  if (revalidatePathStr) revalidatePath(revalidatePathStr);
}

// Returns call/meeting activities scheduled for today (for cron day-of reminders)
export async function getActivitiesDueToday() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);

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
        or(
          eq(activities.type, "call"),
          eq(activities.type, "meeting"),
        ),
      ),
    );
}

/**
 * Returns activities whose reminder should fire within the next `windowMinutes`.
 * Called by the cron worker every minute: finds activities where
 *   (date - reminderMinutes) is between now and now+windowMinutes.
 */
export async function getActivitiesWithPendingReminder(windowMinutes = 2) {
  const now   = new Date();
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
    .where(
      and(
        isNotNull(activities.date),
        isNotNull(activities.reminderMinutes),
      ),
    )
    // Filter in JS: date - reminderMinutes is in [now, ahead]
    .then((rows) =>
      rows.filter((r) => {
        if (!r.date || r.reminderMinutes == null) return false;
        const fireAt = new Date(r.date.getTime() - r.reminderMinutes * 60_000);
        return fireAt >= now && fireAt <= ahead;
      }),
    );
}

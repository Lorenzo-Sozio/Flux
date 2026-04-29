"use server";

import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";

import { getAppointmentCalendarEvents } from "@/actions/appointments";
import { auth } from "@/auth";
import { db } from "@/db";
import { activities, companies, contacts, deals, leads, taskAssignees, tasks, userGroupMembers } from "@/db/schema";

export type CalendarFilter = "all" | "mine" | "group";

async function resolveFilterUserIds(filter: CalendarFilter): Promise<string[] | null> {
  if (filter === "all") return null;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  if (filter === "mine") return [userId];

  // group: all users who share at least one group with the current user
  const myGroups = await db
    .select({ groupId: userGroupMembers.groupId })
    .from(userGroupMembers)
    .where(eq(userGroupMembers.userId, userId));

  if (myGroups.length === 0) return [userId];

  const groupIds = myGroups.map((g) => g.groupId);
  const members = await db
    .select({ userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(inArray(userGroupMembers.groupId, groupIds));

  return [...new Set(members.map((m) => m.userId))];
}

export async function getCalendarEvents(filter: CalendarFilter = "all", range?: { start: Date; end: Date }) {
  const filterIds = await resolveFilterUserIds(filter);

  // Empty set — user not found or group has no members
  if (filterIds !== null && filterIds.length === 0) return [];

  // ── Tasks ────────────────────────────────────────────────────────────────────
  const allTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      allDay: tasks.allDay,
      status: tasks.status,
      priority: tasks.priority,
      leadName: leads.firstName,
      leadLastName: leads.lastName,
      contactName: contacts.firstName,
      contactLastName: contacts.lastName,
      companyName: companies.name,
      dealName: deals.name,
      leadId: tasks.leadId,
      contactId: tasks.contactId,
      companyId: tasks.companyId,
      dealId: tasks.dealId,
    })
    .from(tasks)
    .leftJoin(leads, eq(tasks.leadId, leads.id))
    .leftJoin(contacts, eq(tasks.contactId, contacts.id))
    .leftJoin(companies, eq(tasks.companyId, companies.id))
    .leftJoin(deals, eq(tasks.dealId, deals.id))
    .where(
      and(
        isNotNull(tasks.dueDate),
        range ? gte(tasks.dueDate, range.start) : undefined,
        range ? lte(tasks.dueDate, range.end) : undefined,
        filterIds
          ? or(
              inArray(tasks.ownerId, filterIds),
              inArray(tasks.assigneeId, filterIds),
              inArray(
                tasks.id,
                db.select({ taskId: taskAssignees.taskId }).from(taskAssignees).where(inArray(taskAssignees.userId, filterIds)),
              ),
            )
          : undefined,
      ),
    );

  // ── Activities ────────────────────────────────────────────────────────────────
  const allActivities = await db
    .select({
      id: activities.id,
      title: activities.content,
      date: activities.date,
      type: activities.type,
      leadName: leads.firstName,
      leadLastName: leads.lastName,
      contactName: contacts.firstName,
      contactLastName: contacts.lastName,
      companyName: companies.name,
      dealName: deals.name,
      leadId: activities.leadId,
      contactId: activities.contactId,
      companyId: activities.companyId,
      dealId: activities.dealId,
    })
    .from(activities)
    .leftJoin(leads, eq(activities.leadId, leads.id))
    .leftJoin(contacts, eq(activities.contactId, contacts.id))
    .leftJoin(companies, eq(activities.companyId, companies.id))
    .leftJoin(deals, eq(activities.dealId, deals.id))
    .where(
      and(
        or(eq(activities.type, "meeting"), eq(activities.type, "call")),
        range ? gte(activities.date, range.start) : undefined,
        range ? lte(activities.date, range.end) : undefined,
        filterIds ? inArray(activities.ownerId, filterIds) : undefined,
      ),
    );

  // ── Appointments ─────────────────────────────────────────────────────────────
  const formattedAppointments = await getAppointmentCalendarEvents(filterIds, range);

  // ── Format ───────────────────────────────────────────────────────────────────
  const formattedTasks = allTasks.map((t) => {
    const isAllDay = t.allDay ?? true;
    const date = !isAllDay && t.startDate ? t.startDate : t.dueDate!;
    return {
      id: t.id,
      title: t.title,
      date,
      endAt: !isAllDay ? t.dueDate : undefined,
      allDay: isAllDay,
      type: "task" as const,
      status: t.status,
      priority: t.priority,
      displayTitle: t.title,
      entityName: t.leadName
        ? `${t.leadName} ${t.leadLastName}`
        : t.contactName
          ? `${t.contactName} ${t.contactLastName}`
          : t.companyName || t.dealName || "No Entity",
      link: `/dashboard/tasks?task=${t.id}`,
      leadId: t.leadId,
    };
  });

  const formattedActivities = allActivities
    .filter((a) => a.date)
    .map((a) => ({
      id: a.id,
      title: a.title || "",
      date: a.date!,
      type: a.type as "meeting" | "call",
      status: "active",
      priority: "normal",
      displayTitle: (a.title || "").substring(0, 50) + ((a.title || "").length > 50 ? "..." : ""),
      entityName: a.leadName
        ? `${a.leadName} ${a.leadLastName}`
        : a.contactName
          ? `${a.contactName} ${a.contactLastName}`
          : a.companyName || a.dealName || "No Entity",
      link: a.leadId
        ? `/dashboard/leads/${a.leadId}`
        : a.contactId
          ? `/dashboard/contacts/${a.contactId}`
          : a.dealId
            ? `/dashboard/pipeline?dealId=${a.dealId}`
            : "#",
      leadId: a.leadId,
    }));

  return [...formattedTasks, ...formattedActivities, ...formattedAppointments];
}

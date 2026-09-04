"use server";

import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";

import { getAppointmentCalendarEvents } from "@/actions/appointments";
import { auth } from "@/auth";
import { activities, companies, contacts, deals, leads, taskAssignees, tasks, userGroupMembers } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

export type CalendarFilter = "all" | "mine" | "group";

async function resolveFilterUserIds(filter: CalendarFilter): Promise<string[] | null> {
  const db = await getDb();
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

/**
 * A title for an activity, rather than its body.
 *
 * The calendar printed the note cut at fifty characters, so a paragraph became a
 * sentence that stops mid-word and tells the reader nothing they can act on
 * (audit rilievo M-01). People put a heading on the first line; when they have
 * not, what kind of activity it was is a truer label than half a sentence.
 *
 * English, like `No Entity` below it, because this action hands the page plain
 * strings and the page localises the type badge next to them.
 */
function activityTitle(content: string | null, type: string): string {
  const first = (content ?? "").split("\n")[0].trim();
  if (!first) return type === "call" ? "Call" : "Meeting";
  return first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first;
}

export async function getCalendarEvents(filter: CalendarFilter = "all", range?: { start: Date; end: Date }) {
  const db = await getDb();
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
                db
                  .select({ taskId: taskAssignees.taskId })
                  .from(taskAssignees)
                  .where(inArray(taskAssignees.userId, filterIds)),
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
  const formattedTasks = allTasks
    .filter((t): t is typeof t & { dueDate: Date } => t.dueDate !== null)
    .map((t) => {
      const isAllDay = t.allDay ?? true;
      const date = !isAllDay && t.startDate ? t.startDate : t.dueDate;
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
    .filter((a): a is typeof a & { date: Date } => a.date !== null)
    .map((a) => ({
      id: a.id,
      title: a.title || "",
      date: a.date,
      type: a.type as "meeting" | "call",
      status: "active",
      priority: "normal",
      displayTitle: activityTitle(a.title, a.type),
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

"use server";

import { and, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";

import { getAppointmentCalendarEvents } from "@/actions/appointments";
import type { AgendaItem } from "@/app/(main)/dashboard/crm/_components/agenda-widget";
import { activities, companies, contacts, deals, leads, tasks, tickets } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

/**
 * The day's agenda, in one place.
 *
 * This was a hundred and thirty lines inside the CRM dashboard page: three
 * queries and the mapping that turns them into one ordered list.
 *
 * It was extracted because a separate "Today" screen needed the same list, and a
 * second copy would have drifted from the first within a month. That screen has
 * since gone — it drew this agenda, the same work list and the same ticket queue
 * as the dashboard, which is the page everybody lands on anyway — but the reason
 * to keep the assembly in one place outlived it: the dashboard also ran its own
 * near-identical ticket query, ordered by when a ticket was last touched rather
 * than by when it stops being on time, and now reads `tickets` from here.
 */

/** Whose name to put on a row, from whichever relation it happens to carry. */
function entityNameFrom(row: {
  dealName?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  companyName?: string | null;
}): string | null {
  if (row.dealName) return row.dealName;
  if (row.contactFirstName) return `${row.contactFirstName} ${row.contactLastName ?? ""}`.trim();
  if (row.leadFirstName) return `${row.leadFirstName} ${row.leadLastName ?? ""}`.trim();
  return row.companyName ?? null;
}

/** Where that name goes when clicked. */
function entityHrefFrom(row: {
  dealId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  companyId?: string | null;
}): string | null {
  if (row.dealId) return "/dashboard/pipeline";
  if (row.contactId) return `/dashboard/contacts/${row.contactId}`;
  if (row.leadId) return `/dashboard/leads/${row.leadId}`;
  if (row.companyId) return `/dashboard/companies/${row.companyId}`;
  return null;
}

export interface TicketAtRisk {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  slaDeadlineAt: Date | null;
  updatedAt: Date;
}

export interface TodayView {
  agenda: AgendaItem[];
  tickets: TicketAtRisk[];
  /** Midnight and midnight, so the caller labels the day the same way. */
  dayStartISO: string;
}

/**
 * Everything happening today for the person asking.
 *
 * The agenda is always personal, even for someone who can see the whole
 * workspace: a day belongs to one person, and a shared one is nobody's.
 */
export async function getTodayView(): Promise<TodayView> {
  const actor = await getActor();
  const userId = actor?.userId;
  const db = await getDb();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  // Overdue tasks are worth showing, but not for ever: a task three months late
  // is a backlog problem, and putting it on today's list buries today.
  const lookBack = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);

  if (!userId) return { agenda: [], tickets: [], dayStartISO: todayStart.toISOString() };

  // Someone who can see the whole workspace still gets their own day; only the
  // ticket list widens, because support is worked as a queue.
  const isPrivileged = can(actor, "user:read");

  const mineOnTask = sql`(${tasks.ownerId} = ${userId} OR ${tasks.assigneeId} = ${userId} OR EXISTS (
    SELECT 1 FROM "task_assignee" WHERE task_id = ${tasks.id} AND user_id = ${userId}
  ))`;

  const [myTasks, todayActivities, todayAppointments, openTickets] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        startDate: tasks.startDate,
        allDay: tasks.allDay,
        status: tasks.status,
        priority: tasks.priority,
        estimatedHours: tasks.estimatedHours,
        ticketId: tasks.ticketId,
        leadId: tasks.leadId,
        contactId: tasks.contactId,
        companyId: tasks.companyId,
        dealId: tasks.dealId,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        companyName: companies.name,
        dealName: deals.name,
      })
      .from(tasks)
      .leftJoin(leads, eq(tasks.leadId, leads.id))
      .leftJoin(contacts, eq(tasks.contactId, contacts.id))
      .leftJoin(companies, eq(tasks.companyId, companies.id))
      .leftJoin(deals, eq(tasks.dealId, deals.id))
      .where(
        and(mineOnTask, gte(tasks.dueDate, lookBack), lte(tasks.dueDate, todayEnd), notInArray(tasks.status, ["done"])),
      )
      .orderBy(tasks.dueDate),

    db
      .select({
        id: activities.id,
        type: activities.type,
        content: activities.content,
        date: activities.date,
        durationMinutes: activities.durationMinutes,
        leadId: activities.leadId,
        contactId: activities.contactId,
        companyId: activities.companyId,
        dealId: activities.dealId,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        companyName: companies.name,
        dealName: deals.name,
      })
      .from(activities)
      .leftJoin(leads, eq(activities.leadId, leads.id))
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      .leftJoin(companies, eq(activities.companyId, companies.id))
      .leftJoin(deals, eq(activities.dealId, deals.id))
      .where(
        and(
          inArray(activities.type, ["meeting", "call"]),
          gte(activities.date, todayStart),
          lte(activities.date, todayEnd),
          eq(activities.ownerId, userId),
        ),
      )
      .orderBy(activities.date),

    getAppointmentCalendarEvents([userId]).then((rows) =>
      rows.filter((r) => {
        const d = new Date(r.date);
        return d >= todayStart && d <= todayEnd && r.status !== "cancelled";
      }),
    ),

    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        slaDeadlineAt: tickets.slaDeadlineAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(
        and(
          isPrivileged ? undefined : eq(tickets.assigneeId, userId),
          notInArray(tickets.status, ["resolved", "closed"]),
        ),
      )
      // Soonest deadline first: a queue ordered by when it stops being on time.
      .orderBy(sql`${tickets.slaDeadlineAt} asc nulls last`, desc(tickets.updatedAt))
      .limit(8),
  ]);

  const agenda: AgendaItem[] = [
    ...myTasks.map((task): AgendaItem => {
      const isOverdue = task.dueDate ? new Date(task.dueDate) < todayStart : false;
      // An overdue timed task moves to the all-day band: leaving it on the grid
      // draws it at an hour that has already passed, which reads as a ghost.
      const isAllDay = (task.allDay ?? true) || isOverdue;
      const entityHref = entityHrefFrom(task);
      return {
        id: task.id,
        kind: "task",
        title: task.title,
        allDay: isAllDay,
        timeISO: isAllDay
          ? (task.dueDate?.toISOString() ?? null)
          : ((task.startDate ?? task.dueDate)?.toISOString() ?? null),
        endTimeISO: isAllDay ? null : (task.dueDate?.toISOString() ?? null),
        priority: task.priority,
        status: task.status,
        entityName: entityNameFrom(task),
        entityHref,
        taskHref: task.ticketId ? `/dashboard/support/tickets/${task.ticketId}` : "/dashboard/tasks",
        durationMinutes: null,
        estimatedHours: task.estimatedHours ? String(task.estimatedHours) : null,
        isOverdue,
      };
    }),

    ...todayActivities.map((act): AgendaItem => {
      const entityHref = entityHrefFrom(act);
      const startMs = act.date ? new Date(act.date).getTime() : null;
      return {
        id: act.id,
        kind: act.type as "meeting" | "call",
        title: act.content ?? (act.type === "meeting" ? "Meeting" : "Call"),
        allDay: false,
        timeISO: act.date ? act.date.toISOString() : null,
        endTimeISO:
          startMs && act.durationMinutes ? new Date(startMs + act.durationMinutes * 60_000).toISOString() : null,
        priority: "normal",
        status: "open",
        entityName: entityNameFrom(act),
        entityHref,
        taskHref: entityHref,
        durationMinutes: act.durationMinutes,
        estimatedHours: null,
        isOverdue: false,
      };
    }),

    ...todayAppointments.map((appt): AgendaItem => {
      const endAt = (appt as { endAt?: Date | string | null }).endAt;
      return {
        id: appt.id,
        kind: "appointment",
        title: appt.displayTitle,
        allDay: false,
        timeISO: appt.date ? new Date(appt.date).toISOString() : null,
        endTimeISO: endAt ? new Date(endAt).toISOString() : null,
        priority: "normal",
        status: appt.status,
        entityName: appt.entityName !== "No Entity" ? appt.entityName : null,
        entityHref: appt.link,
        taskHref: appt.link,
        durationMinutes: null,
        estimatedHours: null,
        isOverdue: false,
      };
    }),
  ];

  return { agenda, tickets: openTickets, dayStartISO: todayStart.toISOString() };
}

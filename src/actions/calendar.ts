"use server";

import { revalidatePath } from "next/cache";

import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";

import { getAppointmentCalendarEvents } from "@/actions/appointments";
import { auth } from "@/auth";
import {
  activities,
  companies,
  contacts,
  deals,
  leads,
  taskAssignees,
  tasks,
  userGroupMembers,
  users,
} from "@/db/schema";
import { getAppUrlOrNull } from "@/lib/app-url";
import { requireCapability } from "@/lib/auth-guard";
import { signCalendarFeedToken } from "@/lib/calendar-feed-token";
import { checkExternalCalendarUrl, type UrlRefusal } from "@/lib/external-calendar-url";
import { type ExternalEvent, parseIcal } from "@/lib/ical-parse";
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

// ─── Subscription feed ────────────────────────────────────────────────────────

/**
 * The address to paste into Google Calendar, Outlook or Apple Calendar.
 *
 * ⚠️ The URL is a credential: anyone holding it can read this person's
 * appointments, because a calendar client has no way to log in. The page that
 * shows it says so — a link presented as an ordinary link gets forwarded.
 *
 * Read-only and one-way, which the page also says. An appointment booked here
 * reaches the person's calendar; one booked in Google does not come back. The
 * other direction needs Google to verify the calendar scope, which is not a date
 * this project can promise (audit rilievo S-10).
 */
export async function getCalendarFeedUrl(): Promise<{ url: string } | { error: string }> {
  await requireCapability("record:read");

  const session = await auth();
  const userId = session?.user?.id;
  const tenantId = session?.user?.activeTenantId;
  if (!userId || !tenantId) return { error: "not-signed-in" };

  // Prefers omitting the link to publishing one that points at localhost: a
  // subscription is set up once and then never looked at again, so a wrong
  // address here is wrong for as long as the calendar stays empty (rilievo B-04).
  const base = getAppUrlOrNull();
  if (!base) return { error: "no-app-url" };

  return { url: `${base}/api/calendar/${signCalendarFeedToken({ tenantId, userId })}` };
}

// ─── The calendar somebody keeps elsewhere ────────────────────────────────────

/**
 * How long a fetched calendar is reused before going back for it.
 *
 * The same fifteen minutes our own feed asks subscribers for. Reading somebody
 * else's calendar on every page render would hammer Google for no benefit: an
 * appointment made a minute ago is not more urgent than one made ten.
 */
const EXTERNAL_TTL_SECONDS = 900;

/** The address currently saved for the signed-in person, if any. */
export async function getExternalCalendarUrl(): Promise<string | null> {
  await requireCapability("record:read");
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const db = await getDb();
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { externalCalendarUrl: true },
  });
  return row?.externalCalendarUrl ?? null;
}

/**
 * Saves, or clears, the address of a calendar this person publishes elsewhere.
 *
 * ⚠️ The address is checked before it is stored, not before it is fetched. Both
 * would be better; only one of them is guaranteed to happen, because a stored
 * address is read back by code that has not been written yet.
 */
export async function setExternalCalendarUrl(raw: string): Promise<{ ok: true } | { ok: false; reason: UrlRefusal }> {
  await requireCapability("record:read");
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, reason: "empty" };

  const db = await getDb();

  if (!raw.trim()) {
    await db.update(users).set({ externalCalendarUrl: null }).where(eq(users.id, userId));
    revalidatePath("/dashboard/calendar");
    return { ok: true };
  }

  const verdict = checkExternalCalendarUrl(raw, getAppUrlOrNull());
  if (!verdict.ok) return verdict;

  await db.update(users).set({ externalCalendarUrl: verdict.url }).where(eq(users.id, userId));
  revalidatePath("/dashboard/calendar");
  return { ok: true };
}

export interface ExternalCalendar {
  events: ExternalEvent[];
  /** Events the parser would not guess at. Shown, not swallowed. */
  unreadable: number;
  /** The fetch itself failed: a wrong address, or the far end being down. */
  failed: boolean;
}

/**
 * The busy time from the calendar this person keeps elsewhere.
 *
 * ⚠️ Never throws and never blocks the page. A calendar that cannot be reached
 * is a calendar shown as empty **and said to be**, because the alternative is a
 * screen that looks free while somebody is in a meeting.
 */
export async function getExternalCalendar(window: { from: Date; to: Date }): Promise<ExternalCalendar | null> {
  const url = await getExternalCalendarUrl().catch(() => null);
  if (!url) return null;

  try {
    const response = await fetch(url, {
      // A plain GET with nothing of ours attached: no cookies, no credentials.
      redirect: "follow",
      headers: { Accept: "text/calendar, text/plain" },
      next: { revalidate: EXTERNAL_TTL_SECONDS },
    });
    if (!response.ok) return { events: [], unreadable: 0, failed: true };

    const text = await response.text();
    const parsed = parseIcal(text, window, { defaultZone: "UTC" });
    return { events: parsed.events, unreadable: parsed.skipped.length, failed: false };
  } catch {
    return { events: [], unreadable: 0, failed: true };
  }
}

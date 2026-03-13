"use server";

import { db } from "@/db";
import { tasks, activities, leads, contacts, companies, deals } from "@/db/schema";
import { eq, isNotNull, or } from "drizzle-orm";

export async function getCalendarEvents() {
  // 1. Fetch Tasks with linked entities
  const allTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      date: tasks.dueDate,
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
    .where(isNotNull(tasks.dueDate));

  // 2. Fetch Activities (Meetings and Calls)
  const allActivities = await db
    .select({
      id: activities.id,
      title: activities.content,
      date: activities.date,
      type: activities.type, // 'meeting' or 'call'
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
      or(
        eq(activities.type, "meeting"),
        eq(activities.type, "call")
      )
    );

  // Combine and Format in JavaScript
  const formattedTasks = allTasks.map(t => ({
    id: t.id,
    title: t.title,
    date: t.date!,
    type: "task",
    status: t.status,
    priority: t.priority,
    displayTitle: t.title,
    entityName: t.leadName ? `${t.leadName} ${t.leadLastName}` : 
                t.contactName ? `${t.contactName} ${t.contactLastName}` : 
                t.companyName || t.dealName || "No Entity",
    link: t.leadId ? `/dashboard/leads/${t.leadId}` : 
          t.contactId ? `/dashboard/contacts/${t.contactId}` : 
          t.dealId ? `/dashboard/pipeline?dealId=${t.dealId}` : "#",
    leadId: t.leadId,
  }));

  const formattedActivities = allActivities.filter(a => a.date).map(a => ({
    id: a.id,
    title: a.title || "",
    date: a.date!,
    type: a.type, // meeting or call
    status: "active",
    priority: "normal",
    displayTitle: (a.title || "").substring(0, 50) + ((a.title || "").length > 50 ? "..." : ""),
    entityName: a.leadName ? `${a.leadName} ${a.leadLastName}` : 
                a.contactName ? `${a.contactName} ${a.contactLastName}` : 
                a.companyName || a.dealName || "No Entity",
    link: a.leadId ? `/dashboard/leads/${a.leadId}` : 
          a.contactId ? `/dashboard/contacts/${a.contactId}` : 
          a.dealId ? `/dashboard/pipeline?dealId=${a.dealId}` : "#",
    leadId: a.leadId,
  }));

  return [...formattedTasks, ...formattedActivities];
}

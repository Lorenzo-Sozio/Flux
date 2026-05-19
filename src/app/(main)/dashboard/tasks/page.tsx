import { redirect } from "next/navigation";

import { getCompaniesForSelect, getContactsForSelect, getLeadsForSelect } from "@/actions/crm";
import { getDealsForSelect } from "@/actions/pipeline";
import { getTicketsForSelect } from "@/actions/support";
import { getAllTasks, getAllUsers } from "@/actions/tasks";
import { auth } from "@/auth";

import { TasksClient } from "./_components/tasks-client";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { task: openTaskId } = await searchParams;

  const [taskList, allUsers, leadsList, contactsList, companiesList, dealsList, ticketsList] = await Promise.all([
    getAllTasks(session.user.id, (session.user as any).role ?? "user"),
    getAllUsers(),
    getLeadsForSelect(),
    getContactsForSelect(),
    getCompaniesForSelect(),
    getDealsForSelect(),
    getTicketsForSelect(),
  ]);

  return (
    <TasksClient
      tasks={taskList}
      users={allUsers}
      currentUserId={session.user.id}
      leads={leadsList}
      contacts={contactsList}
      companies={companiesList}
      deals={dealsList}
      tickets={ticketsList}
      initialOpenTaskId={openTaskId}
    />
  );
}

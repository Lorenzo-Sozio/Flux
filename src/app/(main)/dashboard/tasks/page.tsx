import { redirect } from "next/navigation";

import { getCompaniesForSelect, getContactsForSelect, getLeadsForSelect } from "@/actions/crm";
import { getDealsForSelect } from "@/actions/pipeline";
import { getTicketsForSelect } from "@/actions/support";
import { getAllTasks, getAllUsers } from "@/actions/tasks";
import { auth } from "@/auth";
import { LOGIN_PATH } from "@/lib/page-guard";

import { TasksClient } from "./_components/tasks-client";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string; done?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect(LOGIN_PATH);

  const { task: openTaskId, done } = await searchParams;
  // A list is a queue: open work whatever its age, and only what was recently
  // finished. `?done=all` is the archive, and the screen says how much of it
  // there is rather than leaving it to be discovered.
  const includeDone = done === "all";

  const [taskList, allUsers, leadsList, contactsList, companiesList, dealsList, ticketsList] = await Promise.all([
    getAllTasks({ includeDone, alwaysInclude: openTaskId }),
    getAllUsers(),
    getLeadsForSelect(),
    getContactsForSelect(),
    getCompaniesForSelect(),
    getDealsForSelect(),
    getTicketsForSelect(),
  ]);

  return (
    <TasksClient
      tasks={taskList.rows}
      hiddenDone={taskList.hiddenDone}
      capped={taskList.capped}
      showingAll={includeDone}
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

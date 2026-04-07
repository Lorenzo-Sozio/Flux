import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAllTasks, getAllUsers } from "@/actions/tasks";
import { TasksClient } from "./_components/tasks-client";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [taskList, allUsers] = await Promise.all([
    getAllTasks(session.user.id, (session.user as any).role ?? "user"),
    getAllUsers(),
  ]);

  return (
    <TasksClient
      tasks={taskList}
      users={allUsers}
      currentUserId={session.user.id}
    />
  );
}

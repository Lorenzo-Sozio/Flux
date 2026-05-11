import { redirect } from "next/navigation";

import { getAllTasksForGantt, getAllUsers } from "@/actions/tasks";
import { auth } from "@/auth";
import { getDb } from "@/lib/tenant-context";
import { taskDependencies } from "@/db/schema";

import { TaskGantt } from "./_components/task-gantt";

export default async function GanttPage() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [tasks, deps, users] = await Promise.all([
    getAllTasksForGantt(),
    db
      .select({
        id: taskDependencies.id,
        predecessorId: taskDependencies.predecessorId,
        successorId: taskDependencies.successorId,
        type: taskDependencies.type,
        lagDays: taskDependencies.lagDays,
      })
      .from(taskDependencies),
    getAllUsers(),
  ]);

  return <TaskGantt tasks={tasks} dependencies={deps} users={users} />;
}

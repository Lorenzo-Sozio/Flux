import { redirect } from "next/navigation";

import { getAllTasksForGantt } from "@/actions/tasks";
import { auth } from "@/auth";
import { db } from "@/db";
import { taskDependencies } from "@/db/schema";

import { TaskGantt } from "./_components/task-gantt";

export default async function GanttPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [tasks, deps] = await Promise.all([getAllTasksForGantt(), db.select().from(taskDependencies)]);

  return <TaskGantt tasks={tasks} dependencies={deps} />;
}

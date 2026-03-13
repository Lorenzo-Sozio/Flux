import { auth } from "@/auth";
import { db } from "@/db";
import { contacts, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActivitiesByContact, createActivity } from "@/actions/activities";
import { getTasksByContact, createTask, updateTaskStatus, getAllUsers } from "@/actions/tasks";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CalendarIcon, UserIcon, UserCheckIcon, ClockIcon, BuildingIcon } from "lucide-react";
import Link from "next/link";
import { ActivityModal } from "@/components/crm/activity-modal";
import { TaskModal } from "@/components/crm/task-modal";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: contactId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const [contact] = await db
    .select({
      contact: contacts,
      companyName: companies.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(eq(contacts.id, contactId));

  if (!contact) {
    return notFound();
  }

  const { contact: cData, companyName } = contact;
  const activitiesList = await getActivitiesByContact(contactId);
  const tasksList = await getTasksByContact(contactId);
  const allUsers = await getAllUsers();

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({
        type: type || "note",
        content,
        contactId,
        ownerId: userId,
        date: new Date(),
      });
      revalidatePath(`/dashboard/contacts/${contactId}`);
    }
  }

  async function handleAddTask(formData: FormData) {
    "use server";
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const priority = formData.get("priority") as string;
    const dueDateStr = formData.get("dueDate") as string;
    const assigneeId = formData.get("assigneeId") as string;
    
    if (title) {
      await createTask({
        title,
        description,
        status: "todo",
        priority: priority || "normal",
        dueDate: dueDateStr ? new Date(dueDateStr) : undefined,
        contactId,
        ownerId: userId,
        assigneeId: assigneeId || userId,
      });
      revalidatePath(`/dashboard/contacts/${contactId}`);
    }
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    "use server";
    const newStatus = currentStatus === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, `/dashboard/contacts/${contactId}`);
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6">
      {/* Left side: Contact Details */}
      <div className="w-full md:w-1/3 flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Contact Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{cData.firstName} {cData.lastName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Company</p>
              {cData.companyId ? (
                <Link href={`/dashboard/companies/${cData.companyId}`} className="flex items-center gap-1 text-primary hover:underline font-medium">
                  <BuildingIcon className="w-4 h-4" />
                  {companyName}
                </Link>
              ) : (
                <p className="text-muted-foreground italic text-sm">No company linked</p>
              )}
            </div>
            {cData.email && (
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="text-sm">{cData.email}</p>
              </div>
            )}
            {cData.phone && (
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="text-sm">{cData.phone}</p>
              </div>
            )}
            {cData.jobTitle && (
              <div>
                <p className="text-sm text-muted-foreground">Job Title</p>
                <p className="text-sm">{cData.jobTitle}</p>
              </div>
            )}
            <div className="pt-2">
              <Badge variant={cData.marketingConsent ? "default" : "outline"} className="text-[10px]">
                Marketing: {cData.marketingConsent ? "Agreed" : "No Consent"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right side: Timeline & Tasks */}
      <div className="w-full md:w-2/3 flex flex-col gap-6">
        {/* Notes / Activities */}
        <Card>
          <CardHeader><CardTitle>Timeline & Activities</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddActivity} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
              <Textarea name="content" placeholder="Log a call, meeting or note..." required className="bg-background" />
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Type:</p>
                  <select name="type" className="h-8 rounded-md border bg-background px-2 text-xs">
                    <option value="note">Note</option>
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                <Button type="submit" size="sm">Log Activity</Button>
              </div>
            </form>
            <div className="space-y-4 mt-6">
              {activitiesList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activities yet.</p>
              ) : (
                activitiesList.map(activity => (
                  <div key={activity.id} className="border-l-2 border-primary/30 pl-4 py-2 relative">
                    <div className="absolute w-2 h-2 bg-primary rounded-full -left-[5px] top-4" />
                    <div className="flex justify-between items-start">
                       <p className="text-xs font-semibold flex items-center gap-1 text-primary">
                        <UserIcon className="w-3 h-3" />
                        {activity.ownerName || "System"}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-muted-foreground">{new Date(activity.date || activity.createdAt).toLocaleString()}</p>
                        <ActivityModal activity={activity} revalidatePathStr={`/dashboard/contacts/${contactId}`} />
                      </div>
                    </div>
                    <p className="text-sm mt-1">{activity.content}</p>
                    <Badge variant="secondary" className="text-[10px] mt-2 h-4 px-1">{activity.type}</Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader><CardTitle>Tasks & Next Steps</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddTask} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
              <Input name="title" placeholder="Task title..." required />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 text-muted-foreground">Priority</p>
                  <select name="priority" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="low">Low</option>
                    <option value="normal" selected>Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 text-muted-foreground">Due Date & Time</p>
                  <Input name="dueDate" type="datetime-local" className="h-9" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 text-muted-foreground">Assign To</p>
                  <select name="assigneeId" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Myself</option>
                    {allUsers.filter(u => u.id !== userId).map(u => (
                      <option key={u.id} value={u.id}>{u.name || "User"}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" size="sm">Create Task</Button>
            </form>
            <div className="space-y-3 mt-4">
              {tasksList.map(task => (
                <div key={task.id} className={`flex flex-col gap-2 border p-3 rounded-md transition-all ${task.status === "done" ? "opacity-60 bg-muted/30" : "bg-card shadow-sm"}`}>
                  <div className="flex items-start justify-between">
                    <p className={`font-medium text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                    <div className="flex items-center gap-1">
                      <Badge variant={task.priority === "high" ? "destructive" : task.priority === "low" ? "secondary" : "default"} className="text-[10px] uppercase">{task.priority}</Badge>
                      <TaskModal task={task} users={allUsers} revalidatePathStr={`/dashboard/contacts/${contactId}`} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><ClockIcon className="w-3 h-3" />Created: {new Date(task.createdAt).toLocaleString()}</span>
                        {task.dueDate && <span className="flex items-center gap-1 font-semibold"><CalendarIcon className="w-3 h-3" />Due: {new Date(task.dueDate).toLocaleString()}</span>}
                      </div>
                      <span className="flex items-center gap-1 font-medium text-primary/80"><UserCheckIcon className="w-3 h-3" />To: {task.assigneeName || "Myself"}</span>
                    </div>
                    <form action={async () => { "use server"; await toggleTask(task.id, task.status); }}>
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]">{task.status === "done" ? "Undo" : "Mark as Done"}</Button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

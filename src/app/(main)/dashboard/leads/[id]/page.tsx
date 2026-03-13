import { auth } from "@/auth";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActivitiesByLead, createActivity } from "@/actions/activities";
import { getTasksByLead, createTask, updateTaskStatus, getAllUsers } from "@/actions/tasks";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConvertLeadButton } from "./_components/convert-lead-button";
import { CalendarIcon, UserIcon, UserCheckIcon, ClockIcon, CheckCircle2Icon } from "lucide-react";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leadId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

  if (!lead) {
    return notFound();
  }

  const leadActivities = await getActivitiesByLead(leadId);
  const leadTasks = await getTasksByLead(leadId);
  const allUsers = await getAllUsers();

  async function handleAddNote(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    if (content) {
      await createActivity({
        type: "note",
        content,
        leadId,
        ownerId: userId,
        date: new Date(),
      });
      revalidatePath(`/dashboard/leads/${leadId}`);
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
        leadId,
        ownerId: userId,
        assigneeId: assigneeId || userId,
      });
      revalidatePath(`/dashboard/leads/${leadId}`);
    }
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    "use server";
    const newStatus = currentStatus === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, leadId);
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6">
      {/* Left side: Lead Details */}
      <div className="w-full md:w-1/3 flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Lead Details</CardTitle>
            {!lead.isConverted && <ConvertLeadButton leadId={lead.id} />}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{lead.firstName} {lead.lastName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant="outline" className="capitalize">{lead.status}</Badge>
            </div>
            {lead.email && (
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p>{lead.email}</p>
              </div>
            )}
            {lead.phone && (
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p>{lead.phone}</p>
              </div>
            )}
            {lead.companyName && (
              <div>
                <p className="text-sm text-muted-foreground">Company</p>
                <p>{lead.companyName}</p>
              </div>
            )}
            {lead.jobTitle && (
              <div>
                <p className="text-sm text-muted-foreground">Job Title</p>
                <p>{lead.jobTitle}</p>
              </div>
            )}
            {lead.source && (
              <div>
                <p className="text-sm text-muted-foreground">Source</p>
                <p className="capitalize">{lead.source}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right side: Timeline & Tasks */}
      <div className="w-full md:w-2/3 flex flex-col gap-6">
        
        {/* Notes / Activities */}
        <Card>
          <CardHeader>
            <CardTitle>Timeline & Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddNote} className="flex flex-col gap-2">
              <Textarea
                name="content"
                placeholder="Add a new note..."
                required
              />
              <Button type="submit" className="self-end">Add Note</Button>
            </form>
            
            <div className="space-y-4 mt-6">
              {leadActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activities yet.</p>
              ) : (
                leadActivities.map(activity => (
                  <div key={activity.id} className="border-l-2 border-primary/30 pl-4 py-2 relative">
                    <div className="absolute w-2 h-2 bg-primary rounded-full -left-[5px] top-4" />
                    <div className="flex justify-between items-start">
                       <p className="text-xs font-semibold flex items-center gap-1 text-primary">
                        <UserIcon className="w-3 h-3" />
                        {activity.ownerName || "System"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(activity.createdAt).toLocaleString()}
                      </p>
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
          <CardHeader>
            <CardTitle>Tasks & Next Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddTask} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
              <Input name="title" placeholder="Task title..." required />
              <Textarea name="description" placeholder="Short description (optional)..." className="h-20" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 ml-1 text-muted-foreground">Priority</p>
                  <select name="priority" className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors">
                    <option value="low">Low</option>
                    <option value="normal" selected>Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 ml-1 text-muted-foreground">Due Date</p>
                  <Input name="dueDate" type="date" className="h-9" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 ml-1 text-muted-foreground">Assign To</p>
                  <select name="assigneeId" className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors">
                    <option value="">Myself</option>
                    {allUsers.filter(u => u.id !== userId).map(u => (
                      <option key={u.id} value={u.id}>{u.name || "Unnamed User"}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" size="sm" className="mt-2">Create Task</Button>
            </form>
            
            <div className="space-y-3 mt-4">
              {leadTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks pending.</p>
              ) : (
                leadTasks.map(task => (
                  <div key={task.id} className={`flex flex-col gap-2 border p-3 rounded-md transition-all ${task.status === "done" ? "opacity-60 bg-muted/30" : "bg-card shadow-sm"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-1 h-4 w-4 rounded-full border border-primary flex items-center justify-center">
                          {task.status === "done" && <div className="w-2 h-2 bg-primary rounded-full" />}
                        </div>
                        <div>
                          <p className={`font-medium text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                          {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                        </div>
                      </div>
                      <Badge variant={task.priority === "high" ? "destructive" : task.priority === "low" ? "secondary" : "default"} className="text-[10px] uppercase">
                        {task.priority}
                      </Badge>
                    </div>
                    
                    <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-dashed">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <ClockIcon className="w-3 h-3 text-blue-500" />
                          Created: {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                        {task.status === "done" && task.completedAt && (
                          <span className="flex items-center gap-1 font-medium text-green-600">
                            <CheckCircle2Icon className="w-3 h-3" />
                            Completed: {new Date(task.completedAt).toLocaleDateString()}
                          </span>
                        )}
                        {task.dueDate && (
                          <span className={`flex items-center gap-1 font-semibold ${task.status !== "done" && new Date(task.dueDate) < new Date() ? "text-destructive" : "text-foreground/70"}`}>
                            <CalendarIcon className="w-3 h-3" />
                            Due: {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="flex items-center gap-1">
                            <UserIcon className="w-3 h-3" />
                            By: {task.ownerName || "System"}
                          </span>
                          <span className="flex items-center gap-1 font-medium text-primary/80">
                            <UserCheckIcon className="w-3 h-3" />
                            To: {task.assigneeName || "Myself"}
                          </span>
                        </div>
                        <form action={async () => { "use server"; await toggleTask(task.id, task.status); }}>
                          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] bg-background">
                            {task.status === "done" ? "Undo" : "Mark as Done"}
                          </Button>
                        </form>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { auth } from "@/auth";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActivitiesByLead, createActivity } from "@/actions/activities";
import { getTasksByLead, createTask, updateTaskStatus } from "@/actions/tasks";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConvertLeadButton } from "./_components/convert-lead-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, UserIcon } from "lucide-react";

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
    
    if (title) {
      await createTask({
        title,
        description,
        status: "todo",
        priority: priority || "normal",
        dueDate: dueDateStr ? new Date(dueDateStr) : undefined,
        leadId,
        ownerId: userId,
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
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-[10px] uppercase font-bold mb-1 ml-1 text-muted-foreground">Priority</p>
                  <select name="priority" className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors">
                    <option value="low">Low</option>
                    <option value="normal" selected>Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] uppercase font-bold mb-1 ml-1 text-muted-foreground">Due Date</p>
                  <Input name="dueDate" type="date" className="h-9" />
                </div>
              </div>
              <Button type="submit" size="sm" className="mt-2">Create Task</Button>
            </form>
            
            <div className="space-y-3 mt-4">
              {leadTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks pending.</p>
              ) : (
                leadTasks.map(task => (
                  <div key={task.id} className={`flex flex-col gap-2 border p-3 rounded-md transition-all ${task.status === "done" ? "opacity-50 bg-muted/30" : "bg-card"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <input 
                          type="checkbox" 
                          checked={task.status === "done"} 
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          // Note: In a real app we'd use a form action or a client component here
                          // For now, let's keep it simple with a hidden button or link if needed
                        />
                        <div>
                          <p className={`font-medium text-sm ${task.status === "done" ? "line-through" : ""}`}>{task.title}</p>
                          {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                        </div>
                      </div>
                      <Badge variant={task.priority === "high" ? "destructive" : task.priority === "low" ? "secondary" : "default"} className="text-[10px] uppercase">
                        {task.priority}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                        {task.dueDate && (
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3" />
                            {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        <span className="flex items-center gap-1 italic">
                          Created by {task.ownerName || "System"}
                        </span>
                      </div>
                      <form action={async () => { "use server"; await toggleTask(task.id, task.status); }}>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]">
                          {task.status === "done" ? "Mark as Todo" : "Mark as Done"}
                        </Button>
                      </form>
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

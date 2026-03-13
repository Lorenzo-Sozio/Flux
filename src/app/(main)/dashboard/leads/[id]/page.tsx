import { ConvertLeadButton } from "./_components/convert-lead-button";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActivitiesByLead, createActivity } from "@/actions/activities";
import { getTasksByLead, createTask } from "@/actions/tasks";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leadId } = await params;
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
        date: new Date(),
      });
      revalidatePath(`/dashboard/leads/${leadId}`);
    }
  }

  async function handleAddTask(formData: FormData) {
    "use server";
    const title = formData.get("title") as string;
    if (title) {
      await createTask({
        title,
        status: "todo",
        priority: "normal",
        leadId,
      });
      revalidatePath(`/dashboard/leads/${leadId}`);
    }
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
              <Badge>{lead.status}</Badge>
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
                <p>{lead.source}</p>
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
                  <div key={activity.id} className="border-l-2 border-primary/50 pl-4 py-1">
                    <p className="text-xs text-muted-foreground">
                      {new Date(activity.createdAt).toLocaleString()} - <Badge variant="outline">{activity.type}</Badge>
                    </p>
                    <p className="mt-1">{activity.content}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddTask} className="flex gap-2">
              <Input name="title" placeholder="New task title..." required />
              <Button type="submit">Add Task</Button>
            </form>
            
            <div className="space-y-2 mt-4">
              {leadTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks pending.</p>
              ) : (
                leadTasks.map(task => (
                  <div key={task.id} className="flex items-center justify-between border p-3 rounded-md">
                    <div>
                      <p className="font-medium">{task.title}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant={task.status === "done" ? "default" : "secondary"}>
                          {task.status}
                        </Badge>
                        <Badge variant="outline">{task.priority}</Badge>
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

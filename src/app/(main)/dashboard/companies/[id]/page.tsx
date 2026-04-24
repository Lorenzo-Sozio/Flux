import { auth } from "@/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActivitiesByCompany, createActivity } from "@/actions/activities";
import { getTasksByCompany, createTask, updateTaskStatus, getAllUsers } from "@/actions/tasks";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CalendarIcon, UserIcon, UserCheckIcon, ClockIcon, GlobeIcon, PhoneIcon, PencilIcon } from "lucide-react";
import { DocumentPanel } from "@/components/crm/document-panel";
import { RecordVisit } from "@/components/crm/record-visit";
import { CompanyModal } from "@/app/(main)/dashboard/companies/_components/company-modal";
import { ActivityModal } from "@/components/crm/activity-modal";
import { TaskModal } from "@/components/crm/task-modal";
import { FormattedDate } from "@/components/crm/formatted-date";
import { getTranslations } from "next-intl/server";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: companyId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

  if (!company) {
    return notFound();
  }

  const [activitiesList, tasksList, allUsers, t, tD] = await Promise.all([
    getActivitiesByCompany(companyId),
    getTasksByCompany(companyId),
    getAllUsers(),
    getTranslations("companies"),
    getTranslations("entityDetail"),
  ]);

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({
        type: type || "note",
        content,
        companyId,
        ownerId: userId,
        date: new Date(),
      });
      revalidatePath(`/dashboard/companies/${companyId}`);
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
        companyId,
        ownerId: userId,
        assigneeId: assigneeId || userId,
      });
      revalidatePath(`/dashboard/companies/${companyId}`);
    }
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    "use server";
    const newStatus = currentStatus === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, `/dashboard/companies/${companyId}`);
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6">
      <RecordVisit
        type="company"
        name={company.name || "Company"}
        href={`/dashboard/companies/${companyId}`}
      />
      {/* Left side: Company Details */}
      <div className="w-full md:w-1/3 flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("companyDetails")}</CardTitle>
            <CompanyModal company={company}>
              <Button variant="ghost" size="icon" title={t("editCompany")}>
                <PencilIcon className="h-4 w-4" />
              </Button>
            </CompanyModal>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">{tD("fieldName")}</p>
              <p className="font-bold text-lg">{company.name}</p>
            </div>
            {company.website && (
              <div>
                <p className="text-sm text-muted-foreground">{tD("fieldWebsite")}</p>
                <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" className="text-primary hover:underline flex items-center gap-1">
                  <GlobeIcon className="w-4 h-4" />{company.website}
                </a>
              </div>
            )}
            {company.mainPhone && (
              <div>
                <p className="text-sm text-muted-foreground">{tD("fieldPhone")}</p>
                <p className="flex items-center gap-1"><PhoneIcon className="w-4 h-4" />{company.mainPhone}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground">{tD("fieldIndustry")}</p>
              <Badge variant="outline">{company.industry || tD("notApplicable")}</Badge>
            </div>
            {company.vatNumber && (
              <div>
                <p className="text-sm text-muted-foreground">{tD("fieldVatNumber")}</p>
                <p className="text-sm font-mono">{company.vatNumber}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <DocumentPanel entityType="company" entityId={companyId} />
      </div>

      {/* Right side: Timeline & Tasks */}
      <div className="w-full md:w-2/3 flex flex-col gap-6">
        {/* Notes / Activities */}
        <Card>
          <CardHeader><CardTitle>{tD("timelineTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddActivity} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
              <Textarea name="content" placeholder={tD("activityPlaceholder")} required className="bg-background" />
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">{tD("typeLabel")}</p>
                  <select name="type" className="h-8 rounded-md border bg-background px-2 text-xs">
                    <option value="note">{tD("activityTypes.note")}</option>
                    <option value="call">{tD("activityTypes.call")}</option>
                    <option value="meeting">{tD("activityTypes.meeting")}</option>
                    <option value="email">{tD("activityTypes.email")}</option>
                  </select>
                </div>
                <Button type="submit" size="sm">{tD("logActivity")}</Button>
              </div>
            </form>
            <div className="space-y-4 mt-6">
              {activitiesList.map(activity => (
                <div key={activity.id} className="border-l-2 border-primary/30 pl-4 py-2 relative">
                  <div className="absolute w-2 h-2 bg-primary rounded-full -left-[5px] top-4" />
                  <div className="flex justify-between items-start">
                    <p className="text-xs font-semibold flex items-center gap-1 text-primary">
                      <UserIcon className="w-3 h-3" />{activity.ownerName || tD("system")}
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] text-muted-foreground"><FormattedDate date={activity.date || activity.createdAt} /></p>
                      <ActivityModal mode="edit" activity={activity} revalidatePathStr={`/dashboard/companies/${companyId}`} />
                    </div>
                  </div>
                  <p className="text-sm mt-1">{activity.content}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader><CardTitle>{tD("companyTasksTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddTask} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
              <Input name="title" placeholder={tD("companyTaskPlaceholder")} required />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <select name="priority" defaultValue="normal" className="w-full h-9 rounded-md border bg-background text-sm">
                    <option value="low">{tD("priorityLow")}</option>
                    <option value="normal">{tD("priorityNormal")}</option>
                    <option value="high">{tD("priorityHigh")}</option>
                  </select>
                </div>
                <div><Input name="dueDate" type="datetime-local" className="h-9" /></div>
                <div>
                  <select name="assigneeId" className="w-full h-9 rounded-md border bg-background text-sm">
                    <option value="">{tD("myself")}</option>
                    {allUsers.filter(u => u.id !== userId).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" size="sm">{tD("createTask")}</Button>
            </form>
            <div className="space-y-3 mt-4">
              {tasksList.map(task => (
                <div key={task.id} className={`flex flex-col gap-2 border p-3 rounded-md transition-all ${task.status === "done" ? "opacity-60 bg-muted/30" : "bg-card shadow-sm"}`}>
                  <div className="flex items-start justify-between">
                    <p className={`font-medium text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                    <div className="flex items-center gap-1">
                      <Badge variant={task.priority === "high" ? "destructive" : task.priority === "low" ? "secondary" : "default"} className="text-[10px] uppercase">{task.priority}</Badge>
                      <TaskModal task={task} users={allUsers} revalidatePathStr={`/dashboard/companies/${companyId}`} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <ClockIcon className="w-3 h-3" />
                          {tD("createdLabel")} <FormattedDate date={task.createdAt} />
                        </span>
                        {task.dueDate && (
                          <span className="flex items-center gap-1 font-semibold">
                            <CalendarIcon className="w-3 h-3" />
                            {tD("dueLabel")} <FormattedDate date={task.dueDate} />
                          </span>
                        )}
                      </div>
                      <span className="flex items-center gap-1 font-medium text-primary/80">
                        <UserCheckIcon className="w-3 h-3" />
                        {tD("toLabel")} {task.assigneeName || tD("myself")}
                      </span>
                    </div>
                    <form action={async () => { "use server"; await toggleTask(task.id, task.status); }}>
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]">
                        {task.status === "done" ? tD("undo") : tD("markDone")}
                      </Button>
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

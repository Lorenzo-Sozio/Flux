import { auth } from "@/auth";
import { db } from "@/db";
import { contacts, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getActivitiesByContact, createActivity } from "@/actions/activities";
import { getTasksByContact, createTask, updateTaskStatus, getAllUsers } from "@/actions/tasks";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CalendarIcon, UserIcon, UserCheckIcon, ClockIcon, BuildingIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { ContactModal } from "@/app/(main)/dashboard/contacts/_components/contact-modal";
import { ActivityModal } from "@/components/crm/activity-modal";
import { FormattedDate } from "@/components/crm/formatted-date";
import { TaskModal } from "@/components/crm/task-modal";
import { SendEmailModal } from "@/components/crm/send-email-modal";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { DocumentPanel } from "@/components/crm/document-panel";
import { RecordVisit } from "@/components/crm/record-visit";
import { getEmailTemplates } from "@/actions/marketing";
import { getTranslations } from "next-intl/server";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: contactId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  let contact;
  let templates: any[] = [];

  try {
    [contact, templates] = await Promise.all([
      db
        .select({
          contact: contacts,
          companyName: companies.name,
        })
        .from(contacts)
        .leftJoin(companies, eq(contacts.companyId, companies.id))
        .where(eq(contacts.id, contactId))
        .then(rows => rows[0]),
      getEmailTemplates().catch(() => [])
    ]);
  } catch (error) {
    console.error("Error loading contact:", error);
    return notFound();
  }

  if (!contact) {
    return notFound();
  }

  const { contact: cData, companyName } = contact;
  const [activitiesList, tasksList, allUsers, customFieldDefs, customFieldVals, t, tD] = await Promise.all([
    getActivitiesByContact(contactId),
    getTasksByContact(contactId),
    getAllUsers(),
    getCustomFieldDefinitions("contact"),
    getCustomFieldValues("contact", contactId),
    getTranslations("contacts"),
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
      <RecordVisit
        type="contact"
        name={[cData.firstName, cData.lastName].filter(Boolean).join(" ") || "Contact"}
        href={`/dashboard/contacts/${contactId}`}
      />
      {/* Left side: Contact Details */}
      <div className="w-full md:w-1/3 flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("contactDetails")}</CardTitle>
            <div className="flex items-center gap-1">
              <ContactModal contact={cData}>
                <Button variant="ghost" size="icon" title={t("editContact")}>
                  <PencilIcon className="h-4 w-4" />
                </Button>
              </ContactModal>
              <SendEmailModal entity={cData} templates={templates} ownerId={userId} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">{tD("fieldName")}</p>
              <p className="font-medium">{cData.firstName} {cData.lastName}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{tD("fieldCompany")}</p>
              {cData.companyId ? (
                <Link href={`/dashboard/companies/${cData.companyId}`} className="flex items-center gap-1 text-primary hover:underline font-medium">
                  <BuildingIcon className="w-4 h-4" />
                  {companyName}
                </Link>
              ) : (
                <p className="text-muted-foreground italic text-sm">{tD("noCompanyLinked")}</p>
              )}
            </div>
            {cData.email && (
              <div>
                <p className="text-sm text-muted-foreground">{tD("fieldEmail")}</p>
                <p className="text-sm">{cData.email}</p>
              </div>
            )}
            {cData.phone && (
              <div>
                <p className="text-sm text-muted-foreground">{tD("fieldPhone")}</p>
                <p className="text-sm">{cData.phone}</p>
              </div>
            )}
            {cData.jobTitle && (
              <div>
                <p className="text-sm text-muted-foreground">{tD("fieldJobTitle")}</p>
                <p className="text-sm">{cData.jobTitle}</p>
              </div>
            )}
            <div className="pt-2">
              <Badge variant={cData.marketingConsent ? "default" : "outline"} className="text-[10px]">
                {tD("marketingLabel")} {cData.marketingConsent ? tD("marketingAgreed") : tD("marketingNoConsent")}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <CustomFieldsPanel
          entityType="contact"
          entityId={contactId}
          definitions={customFieldDefs}
          values={customFieldVals}
        />

        <DocumentPanel entityType="contact" entityId={contactId} />
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
              {activitiesList.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tD("noActivities")}</p>
              ) : (
                activitiesList.map(activity => (
                  <div key={activity.id} className="border-l-2 border-primary/30 pl-4 py-2 relative">
                    <div className="absolute w-2 h-2 bg-primary rounded-full -left-[5px] top-4" />
                    <div className="flex justify-between items-start">
                       <p className="text-xs font-semibold flex items-center gap-1 text-primary">
                        <UserIcon className="w-3 h-3" />
                        {activity.ownerName || tD("system")}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-muted-foreground"><FormattedDate date={activity.date || activity.createdAt} /></p>
                        <ActivityModal mode="edit" activity={activity} revalidatePathStr={`/dashboard/contacts/${contactId}`} />
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
          <CardHeader><CardTitle>{tD("tasksNextStepsTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form action={handleAddTask} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
              <Input name="title" placeholder={tD("taskTitlePlaceholder")} required />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 text-muted-foreground">{tD("priorityLabel")}</p>
                  <select name="priority" defaultValue="normal" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="low">{tD("priorityLow")}</option>
                    <option value="normal">{tD("priorityNormal")}</option>
                    <option value="high">{tD("priorityHigh")}</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 text-muted-foreground">{tD("dueDateLabel")}</p>
                  <Input name="dueDate" type="datetime-local" className="h-9" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold mb-1 text-muted-foreground">{tD("assignToLabel")}</p>
                  <select name="assigneeId" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">{tD("myself")}</option>
                    {allUsers.filter(u => u.id !== userId).map(u => (
                      <option key={u.id} value={u.id}>{u.name || tD("unnamedUser")}</option>
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
                      <TaskModal task={task} users={allUsers} revalidatePathStr={`/dashboard/contacts/${contactId}`} />
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

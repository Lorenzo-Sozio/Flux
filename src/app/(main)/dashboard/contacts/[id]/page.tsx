import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import {
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  GlobeIcon,
  LinkedinIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  SmartphoneIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createActivity, getActivitiesByContact } from "@/actions/activities";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getEmailTemplates } from "@/actions/marketing";
import { deleteTask, getAllUsers, getTasksByContact, updateTaskStatus } from "@/actions/tasks";
import { ContactModal } from "@/app/(main)/dashboard/contacts/_components/contact-modal";
import { auth } from "@/auth";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { DocumentPanel } from "@/components/crm/document-panel";
import { FormattedDate } from "@/components/crm/formatted-date";
import { QuickTaskForm } from "@/components/crm/quick-task-form";
import { RecordVisit } from "@/components/crm/record-visit";
import { SendEmailModal } from "@/components/crm/send-email-modal";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { companies, contacts } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

const STATUS_STYLES: Record<string, string> = {
  active: "border-green-400 text-green-600 dark:border-green-500 dark:text-green-400",
  inactive: "border-gray-400 text-gray-500 dark:border-gray-600 dark:text-gray-400",
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  const db = await getDb();

  let contactRow;
  let templates: any[] = [];

  try {
    [contactRow, templates] = await Promise.all([
      db
        .select({ contact: contacts, companyName: companies.name })
        .from(contacts)
        .leftJoin(companies, eq(contacts.companyId, companies.id))
        .where(eq(contacts.id, contactId))
        .then((rows) => rows[0]),
      getEmailTemplates().catch(() => []),
    ]);
  } catch (error) {
    console.error("Error loading contact:", error);
    return notFound();
  }

  if (!contactRow) return notFound();

  const { contact: cData, companyName } = contactRow;

  const [activitiesList, tasksList, allUsers, customFieldDefs, customFieldVals, t, tD] = await Promise.all([
    getActivitiesByContact(contactId),
    getTasksByContact(contactId),
    getAllUsers(),
    getCustomFieldDefinitions("contact"),
    getCustomFieldValues("contact", contactId),
    getTranslations("contacts"),
    getTranslations("entityDetail"),
  ]);

  const ownerName = allUsers.find((u) => u.id === cData.ownerId)?.name ?? null;
  const fullName = [cData.firstName, cData.lastName].filter(Boolean).join(" ");
  const initials = [cData.firstName?.[0], cData.lastName?.[0]].filter(Boolean).join("").toUpperCase();
  const hasAddressInfo = !!(cData.street || cData.city || cData.state || cData.zipCode || cData.country);
  const hasContactInfo = !!(cData.email || cData.phone || cData.mobile || cData.linkedinUrl);

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, contactId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/contacts/${contactId}`);
    }
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    "use server";
    const newStatus = currentStatus === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, `/dashboard/contacts/${contactId}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <RecordVisit type="contact" name={fullName || "Contact"} href={`/dashboard/contacts/${contactId}`} />

      {/* ── Hero ── */}
      <Card>
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="flex-shrink-0 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center font-bold text-xl text-primary select-none">
              {initials || <UserIcon className="w-7 h-7" />}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold leading-tight">{fullName}</h1>
              {(cData.jobTitle || cData.department || companyName) && (
                <p className="text-muted-foreground text-sm mt-0.5">
                  {[cData.jobTitle, cData.department, companyName].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Badge variant="outline" className={`capitalize ${STATUS_STYLES[cData.status] ?? ""}`}>
                  {cData.status}
                </Badge>
                {cData.leadScore != null && (
                  <Badge variant="secondary" className="gap-1">
                    <StarIcon className="w-3 h-3" />
                    {tD("fieldScore")}: {cData.leadScore}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <ContactModal contact={cData}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="w-4 h-4 mr-1.5" />
                  {t("editContact")}
                </Button>
              </ContactModal>
              <SendEmailModal entity={cData} templates={templates} ownerId={userId} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          {/* Contact Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tD("sectionContactInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cData.email && (
                <InfoRow label={tD("fieldEmail")}>
                  <a
                    href={`mailto:${cData.email}`}
                    className="flex items-center gap-1.5 text-primary hover:underline break-all"
                  >
                    <MailIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    {cData.email}
                  </a>
                </InfoRow>
              )}
              {cData.phone && (
                <InfoRow label={tD("fieldPhone")}>
                  <a href={`tel:${cData.phone}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <PhoneIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    {cData.phone}
                  </a>
                </InfoRow>
              )}
              {cData.mobile && (
                <InfoRow label={tD("fieldMobile")}>
                  <a href={`tel:${cData.mobile}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <SmartphoneIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    {cData.mobile}
                  </a>
                </InfoRow>
              )}
              {cData.linkedinUrl && (
                <InfoRow label={tD("fieldLinkedIn")}>
                  <a
                    href={cData.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-primary hover:underline truncate"
                  >
                    <LinkedinIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    LinkedIn
                  </a>
                </InfoRow>
              )}
              {!hasContactInfo && <p className="text-sm text-muted-foreground italic">{tD("notApplicable")}</p>}
            </CardContent>
          </Card>

          {/* Company */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tD("sectionCompanyInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoRow label={tD("fieldCompany")}>
                {cData.companyId ? (
                  <Link
                    href={`/dashboard/companies/${cData.companyId}`}
                    className="flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <BuildingIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    {companyName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground italic text-sm">{tD("noCompanyLinked")}</span>
                )}
              </InfoRow>
              {cData.jobTitle && (
                <InfoRow label={tD("fieldJobTitle")}>
                  <span className="flex items-center gap-1.5">
                    <BriefcaseIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    {cData.jobTitle}
                  </span>
                </InfoRow>
              )}
              {cData.department && <InfoRow label={tD("fieldDepartment")}>{cData.department}</InfoRow>}
            </CardContent>
          </Card>

          {/* CRM Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tD("sectionCrmInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoRow label={tD("fieldStatus")}>
                <Badge variant="outline" className={`capitalize ${STATUS_STYLES[cData.status] ?? ""}`}>
                  {cData.status}
                </Badge>
              </InfoRow>
              {cData.leadScore != null && (
                <InfoRow label={tD("fieldScore")}>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={cData.leadScore} className="h-2 flex-1" />
                    <span className="text-sm font-semibold tabular-nums w-8 text-right">{cData.leadScore}</span>
                  </div>
                </InfoRow>
              )}
              {cData.source && (
                <InfoRow label={tD("fieldSource")}>
                  <span className="capitalize">{cData.source}</span>
                </InfoRow>
              )}
              {ownerName && (
                <InfoRow label={tD("fieldOwner")}>
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    {ownerName}
                  </span>
                </InfoRow>
              )}
            </CardContent>
          </Card>

          {/* Address */}
          {hasAddressInfo && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPinIcon className="w-4 h-4 text-muted-foreground" />
                  {tD("sectionAddress")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <address className="not-italic text-sm space-y-0.5 text-foreground/80">
                  {cData.street && <p>{cData.street}</p>}
                  {(cData.city || cData.state || cData.zipCode) && (
                    <p>{[cData.city, cData.state, cData.zipCode].filter(Boolean).join(", ")}</p>
                  )}
                  {cData.country && <p>{cData.country}</p>}
                </address>
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {cData.tags && cData.tags.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TagIcon className="w-4 h-4 text-muted-foreground" />
                  {tD("fieldTags")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {cData.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Marketing Consent */}
          <Card className="bg-muted/30">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                  {tD("marketingLabel")}
                </span>
                <Badge variant={cData.marketingConsent ? "default" : "outline"} className="text-[10px]">
                  {cData.marketingConsent ? tD("marketingAgreed") : tD("marketingNoConsent")}
                </Badge>
              </div>
              {cData.marketingConsent && cData.consentDate && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  <FormattedDate date={cData.consentDate} />
                </p>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {cData.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tD("fieldNotes")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{cData.notes}</p>
              </CardContent>
            </Card>
          )}

          <CustomFieldsPanel
            entityType="contact"
            entityId={contactId}
            definitions={customFieldDefs}
            values={customFieldVals}
          />

          <DocumentPanel entityType="contact" entityId={contactId} />
        </div>

        {/* ── Main: Timeline + Tasks ── */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>{tD("timelineTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={handleAddActivity} className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/20">
                <Textarea name="content" placeholder={tD("activityPlaceholder")} required className="bg-background" />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">{tD("typeLabel")}</p>
                    <select
                      name="type"
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
                    >
                      <option value="note">{tD("activityTypes.note")}</option>
                      <option value="call">{tD("activityTypes.call")}</option>
                      <option value="meeting">{tD("activityTypes.meeting")}</option>
                    </select>
                  </div>
                  <Button type="submit" size="sm">
                    {tD("logActivity")}
                  </Button>
                </div>
              </form>

              <ActivityTimeline activities={activitiesList} revalidatePathStr={`/dashboard/contacts/${contactId}`} />
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>{tD("tasksNextStepsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuickTaskForm entityType="contact" entityId={contactId} userId={userId ?? ""} />

              <div className="space-y-3 mt-2">
                {tasksList.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">{tD("noTasks")}</p>
                ) : (
                  tasksList.map((task) => (
                    <div
                      key={task.id}
                      className={`border rounded-lg p-4 transition-all ${task.status === "done" ? "opacity-60 bg-muted/20" : "bg-card shadow-sm"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              task.status === "done" ? "border-primary bg-primary" : "border-muted-foreground"
                            }`}
                          >
                            {task.status === "done" && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                          </div>
                          <div className="min-w-0">
                            <p
                              className={`font-medium text-sm leading-tight ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}
                            >
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Badge
                            variant={
                              task.priority === "blocker" || task.priority === "high"
                                ? "destructive"
                                : task.priority === "low"
                                  ? "secondary"
                                  : "default"
                            }
                            className={`text-[10px] uppercase ${task.priority === "critical" ? "border-orange-400 text-orange-600 dark:text-orange-400" : ""}`}
                          >
                            {task.priority}
                          </Badge>
                          <TaskModal
                            task={task}
                            users={allUsers}
                            revalidatePathStr={`/dashboard/contacts/${contactId}`}
                          />
                          <form
                            action={async () => {
                              "use server";
                              await deleteTask(task.id, `/dashboard/contacts/${contactId}`);
                            }}
                          >
                            <button
                              type="submit"
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              title="Delete"
                            >
                              <Trash2Icon className="w-3.5 h-3.5" />
                            </button>
                          </form>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-dashed">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <ClockIcon className="w-3 h-3" />
                            {tD("createdLabel")} <FormattedDate date={task.createdAt} />
                          </span>
                          {task.status === "done" && task.completedAt && (
                            <span className="flex items-center gap-1 text-green-600 font-medium">
                              <CheckCircle2Icon className="w-3 h-3" />
                              {tD("completedLabel")} <FormattedDate date={task.completedAt} />
                            </span>
                          )}
                          {task.startDate && (
                            <span className="flex items-center gap-1">
                              <CalendarIcon className="w-3 h-3" />
                              {tD("startLabel")} <FormattedDate date={task.startDate} includeTime={!task.allDay} />
                            </span>
                          )}
                          {task.dueDate && (
                            <span
                              className={`flex items-center gap-1 font-semibold ${
                                task.status !== "done" && new Date(task.dueDate) < new Date() ? "text-destructive" : ""
                              }`}
                            >
                              <CalendarIcon className="w-3 h-3" />
                              {tD("dueLabel")} <FormattedDate date={task.dueDate} includeTime={!task.allDay} />
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <UserCheckIcon className="w-3 h-3" />
                            {tD("toLabel")} {task.assigneeName || tD("myself")}
                          </span>
                        </div>
                        <form
                          action={async () => {
                            "use server";
                            await toggleTask(task.id, task.status);
                          }}
                        >
                          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] bg-background">
                            {task.status === "done" ? tD("undo") : tD("markDone")}
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
    </div>
  );
}

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
import { getCustomerRecord } from "@/actions/customer-record";
import { getEmailTemplates } from "@/actions/marketing";
import { deleteTask, getAllUsers, getTasksByContact, updateTaskStatus } from "@/actions/tasks";
import { ContactModal } from "@/app/(main)/dashboard/contacts/_components/contact-modal";
import { auth } from "@/auth";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { CustomerRecordPanel } from "@/components/crm/customer-record";
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
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="font-medium text-sm">{children}</div>
    </div>
  );
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  const db = await getDb();

  let contactRow: Awaited<ReturnType<typeof loadContact>>;
  let templates: Awaited<ReturnType<typeof getEmailTemplates>> = [];

  const loadContact = () =>
    db
      .select({ contact: contacts, companyName: companies.name })
      .from(contacts)
      .leftJoin(companies, eq(contacts.companyId, companies.id))
      .where(eq(contacts.id, contactId))
      .then((rows) => rows[0]);

  try {
    [contactRow, templates] = await Promise.all([loadContact(), getEmailTemplates().catch(() => [])]);
  } catch (error) {
    console.error("Error loading contact:", error);
    return notFound();
  }

  if (!contactRow) return notFound();

  const { contact: cData, companyName } = contactRow;

  const [activitiesList, tasksList, allUsers, customFieldDefs, customFieldVals, record, t, tD] = await Promise.all([
    getActivitiesByContact(contactId),
    getTasksByContact(contactId),
    getAllUsers(),
    getCustomFieldDefinitions("contact"),
    getCustomFieldValues("contact", contactId),
    // What this person has been sold, which is what a customer page is opened for.
    getCustomerRecord({ contactId }),
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
    <div className="flex flex-col gap-6">
      <RecordVisit type="contact" name={fullName || "Contact"} href={`/dashboard/contacts/${contactId}`} />

      {/* ── Hero ── */}
      <Card>
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="flex h-16 w-16 flex-shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-bold text-primary text-xl">
              {initials || <UserIcon className="h-7 w-7" />}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-2xl leading-tight">{fullName}</h1>
              {(cData.jobTitle || cData.department || companyName) && (
                <p className="mt-0.5 text-muted-foreground text-sm">
                  {[cData.jobTitle, cData.department, companyName].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`capitalize ${STATUS_STYLES[cData.status] ?? ""}`}>
                  {cData.status}
                </Badge>
                {cData.leadScore != null && (
                  <Badge variant="secondary" className="gap-1">
                    <StarIcon className="h-3 w-3" />
                    {tD("fieldScore")}: {cData.leadScore}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <ContactModal contact={cData}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="mr-1.5 h-4 w-4" />
                  {t("editContact")}
                </Button>
              </ContactModal>
              <SendEmailModal entity={cData} templates={templates} ownerId={userId} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3-column body ── */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
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
                    className="flex items-center gap-1.5 break-all text-primary hover:underline"
                  >
                    <MailIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {cData.email}
                  </a>
                </InfoRow>
              )}
              {cData.phone && (
                <InfoRow label={tD("fieldPhone")}>
                  <a href={`tel:${cData.phone}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <PhoneIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {cData.phone}
                  </a>
                </InfoRow>
              )}
              {cData.mobile && (
                <InfoRow label={tD("fieldMobile")}>
                  <a href={`tel:${cData.mobile}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <SmartphoneIcon className="h-3.5 w-3.5 flex-shrink-0" />
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
                    className="flex items-center gap-1.5 truncate text-primary hover:underline"
                  >
                    <LinkedinIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    LinkedIn
                  </a>
                </InfoRow>
              )}
              {!hasContactInfo && <p className="text-muted-foreground text-sm italic">{tD("notApplicable")}</p>}
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
                    <BuildingIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {companyName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-sm italic">{tD("noCompanyLinked")}</span>
                )}
              </InfoRow>
              {cData.jobTitle && (
                <InfoRow label={tD("fieldJobTitle")}>
                  <span className="flex items-center gap-1.5">
                    <BriefcaseIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={cData.leadScore} className="h-2 flex-1" />
                    <span className="w-8 text-right font-semibold text-sm tabular-nums">{cData.leadScore}</span>
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
                    <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPinIcon className="h-4 w-4 text-muted-foreground" />
                  {tD("sectionAddress")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <address className="space-y-0.5 text-foreground/80 text-sm not-italic">
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <TagIcon className="h-4 w-4 text-muted-foreground" />
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
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  {tD("marketingLabel")}
                </span>
                <Badge variant={cData.marketingConsent ? "default" : "outline"} className="text-[10px]">
                  {cData.marketingConsent ? tD("marketingAgreed") : tD("marketingNoConsent")}
                </Badge>
              </div>
              {cData.marketingConsent && cData.consentDate && (
                <p className="mt-1 text-[10px] text-muted-foreground">
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
                <p className="whitespace-pre-wrap text-foreground/80 text-sm">{cData.notes}</p>
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
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Above the notes on purpose: what happened commercially outranks what
              somebody wrote down about it. */}
          <CustomerRecordPanel record={record} contactId={contactId} />

          {/* Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>{tD("timelineTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form action={handleAddActivity} className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
                <Textarea name="content" placeholder={tD("activityPlaceholder")} required className="bg-background" />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-[10px] text-muted-foreground uppercase">{tD("typeLabel")}</p>
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

              <div className="mt-2 space-y-3">
                {tasksList.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground text-sm">{tD("noTasks")}</p>
                ) : (
                  tasksList.map((task) => (
                    <div
                      key={task.id}
                      className={`rounded-lg border p-4 transition-all ${task.status === "done" ? "bg-muted/20 opacity-60" : "bg-card shadow-sm"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                              task.status === "done" ? "border-primary bg-primary" : "border-muted-foreground"
                            }`}
                          >
                            {task.status === "done" && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </div>
                          <div className="min-w-0">
                            <p
                              className={`font-medium text-sm leading-tight ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}
                            >
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{task.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-1.5">
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
                              className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2Icon className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-dashed pt-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <ClockIcon className="h-3 w-3" />
                            {tD("createdLabel")} <FormattedDate date={task.createdAt} />
                          </span>
                          {task.status === "done" && task.completedAt && (
                            <span className="flex items-center gap-1 font-medium text-green-600">
                              <CheckCircle2Icon className="h-3 w-3" />
                              {tD("completedLabel")} <FormattedDate date={task.completedAt} />
                            </span>
                          )}
                          {task.startDate && (
                            <span className="flex items-center gap-1">
                              <CalendarIcon className="h-3 w-3" />
                              {tD("startLabel")} <FormattedDate date={task.startDate} includeTime={!task.allDay} />
                            </span>
                          )}
                          {task.dueDate && (
                            <span
                              className={`flex items-center gap-1 font-semibold ${
                                task.status !== "done" && new Date(task.dueDate) < new Date() ? "text-destructive" : ""
                              }`}
                            >
                              <CalendarIcon className="h-3 w-3" />
                              {tD("dueLabel")} <FormattedDate date={task.dueDate} includeTime={!task.allDay} />
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <UserCheckIcon className="h-3 w-3" />
                            {tD("toLabel")} {task.assigneeName || tD("myself")}
                          </span>
                        </div>
                        <form
                          action={async () => {
                            "use server";
                            await toggleTask(task.id, task.status);
                          }}
                        >
                          <Button variant="outline" size="sm" className="h-6 bg-background px-2 text-[10px]">
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

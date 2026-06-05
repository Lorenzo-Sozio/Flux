import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import {
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  FlameIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  SmartphoneIcon,
  SnowflakeIcon,
  StarIcon,
  TagIcon,
  ThermometerIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createActivity, getActivitiesByLead } from "@/actions/activities";
import { getCompanyCategories, getCompanyTypes } from "@/actions/crm";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getEmailTemplates } from "@/actions/marketing";
import { deleteTask, getAllUsers, getTasksByLead, updateTaskStatus } from "@/actions/tasks";
import { DeleteLeadButton, LeadModal } from "@/app/(main)/dashboard/leads/_components/lead-modal";
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
import { companies, contacts, deals, leads } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

import { ConvertLeadButton } from "./_components/convert-lead-button";

const STATUS_STYLES: Record<string, string> = {
  new: "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400",
  contacting: "border-purple-400 text-purple-600 dark:border-purple-500 dark:text-purple-400",
  engaged: "border-amber-400 text-amber-600 dark:border-amber-500 dark:text-amber-400",
  qualified: "border-green-400 text-green-600 dark:border-green-500 dark:text-green-400",
  unqualified: "border-gray-400 text-gray-500 dark:border-gray-600 dark:text-gray-400",
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="font-medium text-sm">{children}</div>
    </div>
  );
}

function RatingBadge({ rating, label }: { rating: string; label: string }) {
  if (rating === "hot")
    return (
      <Badge className="gap-1 border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
        <FlameIcon className="h-3 w-3" />
        {label}
      </Badge>
    );
  if (rating === "warm")
    return (
      <Badge className="gap-1 border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
        <ThermometerIcon className="h-3 w-3" />
        {label}
      </Badge>
    );
  return (
    <Badge className="gap-1 border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
      <SnowflakeIcon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  const db = await getDb();

  let lead: typeof leads.$inferSelect | undefined;
  let templates: Awaited<ReturnType<typeof getEmailTemplates>> = [];

  try {
    [lead, templates] = await Promise.all([
      db
        .select()
        .from(leads)
        .where(eq(leads.id, leadId))
        .then((rows) => rows[0]),
      getEmailTemplates().catch(() => []),
    ]);
  } catch (error) {
    console.error("Error loading lead:", error);
    return notFound();
  }

  if (!lead) return notFound();

  // Fetch converted entities for the traceability card (only when already converted)
  const [convertedContact, convertedCompany, convertedDeal] = lead.isConverted
    ? await Promise.all([
        lead.convertedToContactId
          ? db
              .select({ firstName: contacts.firstName, lastName: contacts.lastName })
              .from(contacts)
              .where(eq(contacts.id, lead.convertedToContactId))
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
        lead.convertedToCompanyId
          ? db
              .select({ name: companies.name })
              .from(companies)
              .where(eq(companies.id, lead.convertedToCompanyId))
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
        lead.convertedToDealId
          ? db
              .select({ name: deals.name })
              .from(deals)
              .where(eq(deals.id, lead.convertedToDealId))
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
      ])
    : [null, null, null];

  const [leadActivities, leadTasks, allUsers, customFieldDefs, customFieldVals, allCompanyTypes, allCategories, t, tD] =
    await Promise.all([
      getActivitiesByLead(leadId),
      getTasksByLead(leadId),
      getAllUsers(),
      getCustomFieldDefinitions("lead"),
      getCustomFieldValues("lead", leadId),
      getCompanyTypes().catch(() => [] as { id: string; name: string }[]),
      getCompanyCategories().catch(() => [] as { id: string; name: string }[]),
      getTranslations("leads"),
      getTranslations("entityDetail"),
    ]);

  const leadTypeName = lead.leadTypeId ? (allCompanyTypes.find((t) => t.id === lead.leadTypeId)?.name ?? null) : null;
  const leadCategoryName = lead.leadCategoryId
    ? (allCategories.find((c) => c.id === lead.leadCategoryId)?.name ?? null)
    : null;

  const ownerName = allUsers.find((u) => u.id === lead.ownerId)?.name ?? null;
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const initials = [lead.firstName?.[0], lead.lastName?.[0]].filter(Boolean).join("").toUpperCase();
  const hasAddressInfo = !!(lead.street || lead.city || lead.state || lead.zipCode || lead.country);
  const hasCompanyInfo = !!(lead.companyName || lead.jobTitle || lead.industry);

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, leadId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/leads/${leadId}`);
    }
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    "use server";
    const newStatus = currentStatus === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, `/dashboard/leads/${leadId}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <RecordVisit type="lead" name={fullName || "Lead"} href={`/dashboard/leads/${leadId}`} />

      {/* ── Hero ── */}
      <Card>
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="flex h-16 w-16 flex-shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-bold text-primary text-xl">
              {initials || <UserIcon className="h-7 w-7" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-bold text-2xl leading-tight">{fullName}</h1>
                {lead.isConverted && (
                  <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                    <CheckCircle2Icon className="h-3 w-3" />
                    {tD("convertedStatus")}
                  </Badge>
                )}
              </div>
              {(lead.jobTitle || lead.companyName) && (
                <p className="mt-0.5 text-muted-foreground text-sm">
                  {[lead.jobTitle, lead.companyName].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`capitalize ${STATUS_STYLES[lead.status] ?? ""}`}>
                  {lead.status}
                </Badge>
                {lead.rating && (
                  <RatingBadge
                    rating={lead.rating}
                    label={t(`ratings.${lead.rating}` as "ratings.hot" | "ratings.warm" | "ratings.cold")}
                  />
                )}
                {lead.leadScore != null && (
                  <Badge variant="secondary" className="gap-1">
                    <StarIcon className="h-3 w-3" />
                    {tD("fieldScore")}: {lead.leadScore}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <LeadModal lead={lead} categories={allCategories} companyTypes={allCompanyTypes}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="mr-1.5 h-4 w-4" />
                  {t("editLead")}
                </Button>
              </LeadModal>
              <SendEmailModal entity={lead} templates={templates} ownerId={userId} />
              {!lead.isConverted && (
                <ConvertLeadButton
                  leadId={lead.id}
                  leadName={fullName}
                  companyName={lead.companyName}
                  activityCount={leadActivities.length}
                  taskCount={leadTasks.length}
                />
              )}
              <DeleteLeadButton lead={lead} redirectTo="/dashboard/leads" />
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
              {lead.email && (
                <InfoRow label={tD("fieldEmail")}>
                  <a
                    href={`mailto:${lead.email}`}
                    className="flex items-center gap-1.5 break-all text-primary hover:underline"
                  >
                    <MailIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {lead.email}
                  </a>
                </InfoRow>
              )}
              {lead.phone && (
                <InfoRow label={tD("fieldPhone")}>
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <PhoneIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {lead.phone}
                  </a>
                </InfoRow>
              )}
              {lead.mobile && (
                <InfoRow label={tD("fieldMobile")}>
                  <a href={`tel:${lead.mobile}`} className="flex items-center gap-1.5 text-primary hover:underline">
                    <SmartphoneIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {lead.mobile}
                  </a>
                </InfoRow>
              )}
              {lead.website && (
                <InfoRow label={tD("fieldWebsite")}>
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 truncate text-primary hover:underline"
                  >
                    <GlobeIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {lead.website.replace(/^https?:\/\//, "")}
                  </a>
                </InfoRow>
              )}
              {!lead.email && !lead.phone && !lead.mobile && !lead.website && (
                <p className="text-muted-foreground text-sm italic">{tD("notApplicable")}</p>
              )}
            </CardContent>
          </Card>

          {/* Qualification */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tD("sectionQualification")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <InfoRow label={tD("fieldStatus")}>
                <Badge variant="outline" className={`capitalize ${STATUS_STYLES[lead.status] ?? ""}`}>
                  {lead.status}
                </Badge>
              </InfoRow>
              {lead.rating && (
                <InfoRow label={tD("fieldRating")}>
                  <RatingBadge
                    rating={lead.rating}
                    label={t(`ratings.${lead.rating}` as "ratings.hot" | "ratings.warm" | "ratings.cold")}
                  />
                </InfoRow>
              )}
              {lead.leadScore != null && (
                <InfoRow label={tD("fieldScore")}>
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={lead.leadScore} className="h-2 flex-1" />
                    <span className="w-8 text-right font-semibold text-sm tabular-nums">{lead.leadScore}</span>
                  </div>
                </InfoRow>
              )}
              {lead.source && (
                <InfoRow label={tD("fieldSource")}>
                  <span className="capitalize">{lead.source}</span>
                </InfoRow>
              )}
              {leadTypeName && (
                <InfoRow label={t("form.leadType")}>
                  <span>{leadTypeName}</span>
                </InfoRow>
              )}
              {leadCategoryName && (
                <InfoRow label={t("form.leadCategory")}>
                  <span>{leadCategoryName}</span>
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

          {/* Company & Role */}
          {hasCompanyInfo && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tD("sectionCompanyInfo")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {lead.companyName && (
                  <InfoRow label={tD("fieldCompany")}>
                    <span className="flex items-center gap-1.5">
                      <BuildingIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {lead.companyName}
                    </span>
                  </InfoRow>
                )}
                {lead.jobTitle && (
                  <InfoRow label={tD("fieldJobTitle")}>
                    <span className="flex items-center gap-1.5">
                      <BriefcaseIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {lead.jobTitle}
                    </span>
                  </InfoRow>
                )}
                {lead.industry && <InfoRow label={tD("fieldIndustry")}>{lead.industry}</InfoRow>}
              </CardContent>
            </Card>
          )}

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
                  {lead.street && <p>{lead.street}</p>}
                  {(lead.city || lead.state || lead.zipCode) && (
                    <p>{[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}</p>
                  )}
                  {lead.country && <p>{lead.country}</p>}
                </address>
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {lead.tags && lead.tags.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TagIcon className="h-4 w-4 text-muted-foreground" />
                  {tD("fieldTags")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((tag) => (
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
                <Badge variant={lead.marketingConsent ? "default" : "outline"} className="text-[10px]">
                  {lead.marketingConsent ? tD("marketingAgreed") : tD("marketingNoConsent")}
                </Badge>
              </div>
              {lead.marketingConsent && lead.consentDate && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  <FormattedDate date={lead.consentDate} />
                </p>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {lead.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tD("fieldNotes")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-foreground/80 text-sm">{lead.notes}</p>
              </CardContent>
            </Card>
          )}

          <CustomFieldsPanel
            entityType="lead"
            entityId={leadId}
            definitions={customFieldDefs}
            values={customFieldVals}
          />

          <DocumentPanel entityType="lead" entityId={leadId} />

          {/* Converted-to traceability card */}
          {lead.isConverted && (convertedContact || convertedCompany || convertedDeal) && (
            <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="h-4 w-4" />
                  Convertito in
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {convertedContact && (
                  <a
                    href={`/dashboard/contacts?contactId=${lead.convertedToContactId}`}
                    className="flex items-center gap-2 font-medium text-primary text-sm hover:underline"
                  >
                    <UserIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {convertedContact.firstName} {convertedContact.lastName}
                  </a>
                )}
                {convertedCompany && (
                  <a
                    href={`/dashboard/companies/${lead.convertedToCompanyId}`}
                    className="flex items-center gap-2 font-medium text-primary text-sm hover:underline"
                  >
                    <BuildingIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {convertedCompany.name}
                  </a>
                )}
                {convertedDeal && (
                  <a
                    href={`/dashboard/pipeline?dealId=${lead.convertedToDealId}`}
                    className="flex items-center gap-2 font-medium text-primary text-sm hover:underline"
                  >
                    <BriefcaseIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {convertedDeal.name}
                  </a>
                )}
                {lead.convertedAt && (
                  <p className="border-t pt-1 text-[10px] text-muted-foreground">
                    Convertito il <FormattedDate date={lead.convertedAt} />
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Main: Timeline + Tasks ── */}
        <div className="flex flex-col gap-6 lg:col-span-2">
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

              <ActivityTimeline activities={leadActivities} revalidatePathStr={`/dashboard/leads/${leadId}`} />
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>{tD("tasksNextStepsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuickTaskForm entityType="lead" entityId={leadId} userId={userId ?? ""} />

              <div className="mt-2 space-y-3">
                {leadTasks.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground text-sm">{tD("noTasks")}</p>
                ) : (
                  leadTasks.map((task) => (
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
                          <TaskModal task={task} users={allUsers} revalidatePathStr={`/dashboard/leads/${leadId}`} />
                          <form
                            action={async () => {
                              "use server";
                              await deleteTask(task.id, `/dashboard/leads/${leadId}`);
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

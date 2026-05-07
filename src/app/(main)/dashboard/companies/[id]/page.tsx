import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import type { LucideIcon } from "lucide-react";
import {
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneCallIcon,
  PhoneIcon,
  ReceiptIcon,
  StickyNoteIcon,
  TagIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createActivity, deleteActivity, getActivitiesByCompany } from "@/actions/activities";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { deleteTask, getAllUsers, getTasksByCompany, updateTaskStatus } from "@/actions/tasks";
import { CompanyModal } from "@/app/(main)/dashboard/companies/_components/company-modal";
import { auth } from "@/auth";
import { ActivityModal } from "@/components/crm/activity-modal";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { DocumentPanel } from "@/components/crm/document-panel";
import { FormattedDate } from "@/components/crm/formatted-date";
import { QuickTaskForm } from "@/components/crm/quick-task-form";
import { RecordVisit } from "@/components/crm/record-visit";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db";
import { companies } from "@/db/schema";

const TYPE_STYLES: Record<string, string> = {
  customer: "border-green-400 text-green-600 dark:border-green-500 dark:text-green-400",
  prospect: "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400",
  partner: "border-purple-400 text-purple-600 dark:border-purple-500 dark:text-purple-400",
  vendor: "border-amber-400 text-amber-600 dark:border-amber-500 dark:text-amber-400",
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  note: StickyNoteIcon,
  call: PhoneCallIcon,
  meeting: CalendarIcon,
  email: MailIcon,
};

const ACTIVITY_COLORS: Record<string, string> = {
  note: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  call: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
  meeting: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  email: "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return notFound();

  const [activitiesList, tasksList, allUsers, customFieldDefs, customFieldVals, t, tD] = await Promise.all([
    getActivitiesByCompany(companyId),
    getTasksByCompany(companyId),
    getAllUsers(),
    getCustomFieldDefinitions("company"),
    getCustomFieldValues("company", companyId),
    getTranslations("companies"),
    getTranslations("entityDetail"),
  ]);

  const ownerName = allUsers.find((u) => u.id === company.ownerId)?.name ?? null;
  const initial = company.name?.[0]?.toUpperCase() ?? "C";
  const hasAddressInfo = !!(company.street || company.city || company.state || company.zipCode || company.country);
  const hasBillingInfo = !!(company.vatNumber || company.sdiCode);
  const hasContactInfo = !!(company.mainEmail || company.mainPhone || company.website);

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, companyId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/companies/${companyId}`);
    }
  }

  async function toggleTask(taskId: string, currentStatus: string) {
    "use server";
    const newStatus = currentStatus === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, `/dashboard/companies/${companyId}`);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <RecordVisit type="company" name={company.name || "Company"} href={`/dashboard/companies/${companyId}`} />

      {/* ── Hero ── */}
      <Card>
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center font-bold text-xl text-primary select-none">
              {initial}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold leading-tight">{company.name}</h1>
              {(company.industry || company.city) && (
                <p className="text-muted-foreground text-sm mt-0.5">
                  {[company.industry, company.city].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {company.type && (
                  <Badge variant="outline" className={`capitalize ${TYPE_STYLES[company.type] ?? ""}`}>
                    {company.type}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={
                    company.status === "active"
                      ? "border-green-400 text-green-600 dark:border-green-500 dark:text-green-400"
                      : "border-gray-400 text-gray-500"
                  }
                >
                  {company.status}
                </Badge>
                {company.employeeCount != null && (
                  <Badge variant="secondary" className="gap-1">
                    <UsersIcon className="w-3 h-3" />
                    {company.employeeCount}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <CompanyModal company={company}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="w-4 h-4 mr-1.5" />
                  {t("editCompany")}
                </Button>
              </CompanyModal>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          {/* Contact Info */}
          {hasContactInfo && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tD("sectionContactInfo")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {company.mainEmail && (
                  <InfoRow label={tD("fieldEmail")}>
                    <a
                      href={`mailto:${company.mainEmail}`}
                      className="flex items-center gap-1.5 text-primary hover:underline break-all"
                    >
                      <MailIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      {company.mainEmail}
                    </a>
                  </InfoRow>
                )}
                {company.mainPhone && (
                  <InfoRow label={tD("fieldPhone")}>
                    <a
                      href={`tel:${company.mainPhone}`}
                      className="flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <PhoneIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      {company.mainPhone}
                    </a>
                  </InfoRow>
                )}
                {company.website && (
                  <InfoRow label={tD("fieldWebsite")}>
                    <a
                      href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-primary hover:underline truncate"
                    >
                      <GlobeIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      {company.website.replace(/^https?:\/\//, "")}
                    </a>
                  </InfoRow>
                )}
              </CardContent>
            </Card>
          )}

          {/* Company Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BuildingIcon className="w-4 h-4 text-muted-foreground" />
                {t("companyDetails")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {company.type && (
                <InfoRow label={tD("fieldType")}>
                  <Badge variant="outline" className={`capitalize ${TYPE_STYLES[company.type] ?? ""}`}>
                    {company.type}
                  </Badge>
                </InfoRow>
              )}
              {company.industry && <InfoRow label={tD("fieldIndustry")}>{company.industry}</InfoRow>}
              {company.source && (
                <InfoRow label={tD("fieldSource")}>
                  <span className="capitalize">{company.source}</span>
                </InfoRow>
              )}
              {company.employeeCount != null && (
                <InfoRow label={tD("fieldEmployees")}>
                  <span className="flex items-center gap-1.5">
                    <UsersIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    {company.employeeCount.toLocaleString()}
                  </span>
                </InfoRow>
              )}
              {company.annualRevenue && (
                <InfoRow label={tD("fieldRevenue")}>
                  {Number(company.annualRevenue).toLocaleString(undefined, {
                    style: "currency",
                    currency: "EUR",
                    maximumFractionDigits: 0,
                  })}
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
                  {company.street && <p>{company.street}</p>}
                  {(company.city || company.state || company.zipCode) && (
                    <p>{[company.city, company.state, company.zipCode].filter(Boolean).join(", ")}</p>
                  )}
                  {company.country && <p>{company.country}</p>}
                </address>
              </CardContent>
            </Card>
          )}

          {/* Billing */}
          {hasBillingInfo && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ReceiptIcon className="w-4 h-4 text-muted-foreground" />
                  Billing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {company.vatNumber && (
                  <InfoRow label={tD("fieldVatNumber")}>
                    <span className="font-mono">{company.vatNumber}</span>
                  </InfoRow>
                )}
                {company.sdiCode && (
                  <InfoRow label={tD("fieldSdiCode")}>
                    <span className="font-mono">{company.sdiCode}</span>
                  </InfoRow>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {company.tags && company.tags.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TagIcon className="w-4 h-4 text-muted-foreground" />
                  {tD("fieldTags")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {company.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Description */}
          {company.description && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tD("fieldDescription")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{company.description}</p>
              </CardContent>
            </Card>
          )}

          <CustomFieldsPanel
            entityType="company"
            entityId={companyId}
            definitions={customFieldDefs}
            values={customFieldVals}
          />

          <DocumentPanel entityType="company" entityId={companyId} />
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
                      <option value="email">{tD("activityTypes.email")}</option>
                    </select>
                  </div>
                  <Button type="submit" size="sm">
                    {tD("logActivity")}
                  </Button>
                </div>
              </form>

              <div className="space-y-3 mt-2">
                {activitiesList.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">{tD("noActivities")}</p>
                ) : (
                  activitiesList.map((activity) => {
                    const ActivityIcon = ACTIVITY_ICONS[activity.type] ?? StickyNoteIcon;
                    const iconClass = ACTIVITY_COLORS[activity.type] ?? ACTIVITY_COLORS.note;
                    return (
                      <div key={activity.id} className="flex gap-3">
                        <div
                          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${iconClass}`}
                        >
                          <ActivityIcon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0 border rounded-lg p-3 bg-card">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-primary flex items-center gap-1">
                              <UserIcon className="w-3 h-3" />
                              {activity.ownerName || tD("system")}
                            </p>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <p className="text-[10px] text-muted-foreground">
                                <FormattedDate date={activity.date || activity.createdAt} />
                              </p>
                              <ActivityModal
                                mode="edit"
                                activity={activity}
                                revalidatePathStr={`/dashboard/companies/${companyId}`}
                              />
                              <form
                                action={async () => {
                                  "use server";
                                  await deleteActivity(activity.id, `/dashboard/companies/${companyId}`);
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
                          <p className="text-sm mt-1.5">{activity.content}</p>
                          <Badge variant="secondary" className="text-[10px] mt-2 h-4 px-1 capitalize">
                            {activity.type}
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>{tD("companyTasksTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuickTaskForm entityType="company" entityId={companyId} userId={userId ?? ""} />

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
                            revalidatePathStr={`/dashboard/companies/${companyId}`}
                          />
                          <form
                            action={async () => {
                              "use server";
                              await deleteTask(task.id, `/dashboard/companies/${companyId}`);
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

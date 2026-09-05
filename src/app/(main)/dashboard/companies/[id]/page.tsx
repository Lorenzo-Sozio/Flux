import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import {
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  ReceiptIcon,
  TagIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createActivity, getActivitiesByCompany } from "@/actions/activities";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getCustomerRecord } from "@/actions/customer-record";
import { deleteTask, getAllUsers, getTasksByCompany, updateTaskStatus } from "@/actions/tasks";
import { CompanyModal } from "@/app/(main)/dashboard/companies/_components/company-modal";
import { auth } from "@/auth";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { CustomerRecordPanel } from "@/components/crm/customer-record";
import { DocumentPanel } from "@/components/crm/document-panel";
import { FormattedDate } from "@/components/crm/formatted-date";
import { QuickTaskForm } from "@/components/crm/quick-task-form";
import { RecordVisit } from "@/components/crm/record-visit";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { companies } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

const TYPE_STYLES: Record<string, string> = {
  customer: "border-green-400 text-green-600 dark:border-green-500 dark:text-green-400",
  prospect: "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400",
  partner: "border-purple-400 text-purple-600 dark:border-purple-500 dark:text-purple-400",
  vendor: "border-amber-400 text-amber-600 dark:border-amber-500 dark:text-amber-400",
};

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="font-medium text-sm">{children}</div>
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return notFound();

  const [activitiesList, tasksList, allUsers, customFieldDefs, customFieldVals, record, t, tD] = await Promise.all([
    getActivitiesByCompany(companyId),
    getTasksByCompany(companyId),
    getAllUsers(),
    getCustomFieldDefinitions("company"),
    getCustomFieldValues("company", companyId),
    // What has been sold here, which is what a business opens a customer for.
    getCustomerRecord({ companyId }),
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
    <div className="flex flex-col gap-6">
      <RecordVisit type="company" name={company.name || "Company"} href={`/dashboard/companies/${companyId}`} />

      {/* ── Hero ── */}
      <Card>
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="flex h-16 w-16 flex-shrink-0 select-none items-center justify-center rounded-xl bg-primary/10 font-bold text-primary text-xl">
              {initial}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-2xl leading-tight">{company.name}</h1>
              {(company.industry || company.city) && (
                <p className="mt-0.5 text-muted-foreground text-sm">
                  {[company.industry, company.city].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
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
                    <UsersIcon className="h-3 w-3" />
                    {company.employeeCount}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              <CompanyModal company={company}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="mr-1.5 h-4 w-4" />
                  {t("editCompany")}
                </Button>
              </CompanyModal>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 3-column body ── */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
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
                      className="flex items-center gap-1.5 break-all text-primary hover:underline"
                    >
                      <MailIcon className="h-3.5 w-3.5 flex-shrink-0" />
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
                      <PhoneIcon className="h-3.5 w-3.5 flex-shrink-0" />
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
                      className="flex items-center gap-1.5 truncate text-primary hover:underline"
                    >
                      <GlobeIcon className="h-3.5 w-3.5 flex-shrink-0" />
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
              <CardTitle className="flex items-center gap-2 text-base">
                <BuildingIcon className="h-4 w-4 text-muted-foreground" />
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
                    <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <ReceiptIcon className="h-4 w-4 text-muted-foreground" />
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <TagIcon className="h-4 w-4 text-muted-foreground" />
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
                <p className="whitespace-pre-wrap text-foreground/80 text-sm">{company.description}</p>
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
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Above the notes on purpose: what happened commercially outranks what
              somebody wrote down about it. */}
          <CustomerRecordPanel record={record} companyId={companyId} />

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

              <ActivityTimeline activities={activitiesList} revalidatePathStr={`/dashboard/companies/${companyId}`} />
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>{tD("companyTasksTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <QuickTaskForm entityType="company" entityId={companyId} userId={userId ?? ""} />

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

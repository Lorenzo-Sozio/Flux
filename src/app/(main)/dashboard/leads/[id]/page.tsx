import type { ReactNode } from "react";

import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";

import { and, eq } from "drizzle-orm";
import {
  BotIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  FlameIcon,
  InfoIcon,
  ListChecksIcon,
  MapPinIcon,
  MegaphoneIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  SnowflakeIcon,
  ThermometerIcon,
  Trash2Icon,
  UserIcon,
  UserRoundIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { createActivity, getActivitiesByLead } from "@/actions/activities";
import { getCompanyCategories, getCompanyTypes } from "@/actions/crm";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getComposerTemplates } from "@/actions/email-templates";
import { deleteTask, getAllUsers, getTasksByLead } from "@/actions/tasks";
import { DeleteLeadButton, LeadModal } from "@/app/(main)/dashboard/leads/_components/lead-modal";
import { auth } from "@/auth";
import { AiSummaryCard } from "@/components/crm/ai/ai-summary-card";
import { ConsentDetail } from "@/components/crm/consent-detail";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { DocumentPanel } from "@/components/crm/document-panel";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { EnrollInSequence } from "@/components/crm/enroll-in-sequence";
import { FormattedDate } from "@/components/crm/formatted-date";
import { PrivacyCard } from "@/components/crm/privacy-card";
import { QuickTaskForm } from "@/components/crm/quick-task-form";
import {
  EmptyHint,
  Field,
  FieldList,
  MetaItem,
  Metric,
  MetricStrip,
  RecordAvatar,
  RecordBackLink,
  RecordHero,
  RecordPage,
  StatusBadge,
  SubHeading,
  type Tone,
} from "@/components/crm/record/record-page";
import { RecordComposer, RecordSections } from "@/components/crm/record/record-sections";
import { RecordTimeline } from "@/components/crm/record-timeline";
import { RecordVisit } from "@/components/crm/record-visit";
import { SendEmailModal } from "@/components/crm/send-email-modal";
import { TaskDoneButton } from "@/components/crm/task-done-button";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { companies, contacts, deals, leads } from "@/db/schema";
import { aiEntries, aiViewer } from "@/lib/ai/access";
import { getTenantEntitlements } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { sourceLabeller } from "@/lib/record-sources-load";
import { recordTimelineSummary } from "@/lib/record-timeline";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";

import { ConvertLeadButton } from "./_components/convert-lead-button";
import { LeadStatusPath } from "./_components/lead-status-path";
import { LEAD_STEPS } from "./_components/lead-steps";

const DAY = 86_400_000;

/**
 * The shared tones: still being worked is blue, qualified or converted is green,
 * and unqualified is grey — a closed door, not an alarm that wants acting on.
 */
const STATUS_TONE: Record<string, Tone> = {
  new: "info",
  contacting: "info",
  engaged: "info",
  qualified: "success",
  unqualified: "neutral",
  converted: "success",
};

const RATING: Record<string, { tone: Tone; icon: ReactNode }> = {
  hot: { tone: "danger", icon: <FlameIcon aria-hidden /> },
  warm: { tone: "warning", icon: <ThermometerIcon aria-hidden /> },
  cold: { tone: "info", icon: <SnowflakeIcon aria-hidden /> },
};

const PRIORITY_KEY: Record<string, string> = {
  low: "priorityLow",
  normal: "priorityNormal",
  high: "priorityHigh",
  critical: "priorityCritical",
  blocker: "priorityBlocker",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-muted-foreground",
  high: "text-amber-700 dark:text-amber-400",
  critical: "text-destructive",
  blocker: "text-destructive",
};

/** What counts as having spoken to the lead. A note is written about them, not to them. */
const CONTACT_TYPES = new Set(["call", "meeting", "email"]);

/** Open tasks shown before the rest fold away under "show more". */
const TASKS_SHOWN = 5;

/** Midnight of a date, so "due today" does not turn overdue at 9am. */
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * One lead, laid out for the person qualifying it.
 *
 * Built on the same kit as the deal page, in the same order: what it is and how
 * warm (the hero, with the qualification path where the deal has its stages),
 * the figures that say whether to chase it (score, age, last contact, next
 * step), what to do next and what has happened (the work column), and who they
 * are (the reference column). Converting is the thing a lead exists for, so it
 * is the one filled button while the lead is open; once converted, a banner in
 * the hero says what it became and links to each record.
 */
export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  // ⚠️ The workspace role, not `session.user.role` (Flux's own staff scale). A
  // viewer reads the lead; the controls that would only answer "forbidden" are
  // not drawn for them. See CLAUDE.md on the two role scales.
  const canWrite = can(session?.user?.tenantRole ?? null, "record:write");
  // ⚠️ Everything that does not need the lead is started now and awaited where it is used: these
  // reads used to wait for one another, a dozen round trips in a row before the page could draw.
  const aiP: ReturnType<typeof aiEntries<"summary" | "draft">> = canWrite
    ? aiEntries(["summary", "draft"] as const, aiViewer(session?.user))
    : Promise.resolve({});
  const db = await getDb();
  // A colleague's lead is not found, rather than refused: a refusal would confirm it exists.
  const scope = await recordScope();
  // Sequences belong to the marketing module: without it the button opens a
  // dialog whose every action is refused by the server.
  const hasMarketingP = getTenantEntitlements()
    .catch(() => null)
    .then((ent) => ent?.enabledModules?.includes("marketing") ?? true);
  // The timeline's count and last contact, from the same source as the list.
  const timelineSummaryP = recordTimelineSummary(db, { type: "lead", id: leadId });
  const restP = Promise.all([
    getActivitiesByLead(leadId),
    getTasksByLead(leadId),
    getAllUsers(),
    getCustomFieldDefinitions("lead"),
    getCustomFieldValues("lead", leadId),
    getCompanyTypes().catch(() => [] as { id: string; name: string }[]),
    getCompanyCategories().catch(() => [] as { id: string; name: string }[]),
    getTranslations("leads"),
    getTranslations("entityDetail"),
    getTranslations("common"),
    getTranslations("record"),
    getTranslations("pipeline"),
    getTranslations("pipeline.detail"),
    getFormatter(),
  ]);
  // Rejections are read where each is awaited; until then they must not surface as unhandled.
  for (const pending of [aiP, timelineSummaryP, restP]) pending.catch(() => undefined);

  let lead: typeof leads.$inferSelect | undefined;
  let templates: Awaited<ReturnType<typeof getComposerTemplates>> = [];

  try {
    [lead, templates] = await Promise.all([
      db
        .select()
        .from(leads)
        .where(and(eq(leads.id, leadId), visibleWhere("lead", scope)))
        .then((rows) => rows[0]),
      getComposerTemplates().catch(() => []),
    ]);
  } catch (error) {
    console.error("Error loading lead:", error);
    return notFound();
  }

  if (!lead) return notFound();

  // What the lead became, by name — only fetched once it has been converted.
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

  const [
    leadActivities,
    leadTasks,
    allUsers,
    customFieldDefs,
    customFieldVals,
    allCompanyTypes,
    allCategories,
    t,
    tD,
    tc,
    tR,
    tP,
    tX,
    format,
  ] = await restP;
  const [ai, hasMarketing] = await Promise.all([aiP, hasMarketingP]);

  const leadTypeName = lead.leadTypeId ? (allCompanyTypes.find((ct) => ct.id === lead.leadTypeId)?.name ?? null) : null;
  const leadCategoryName = lead.leadCategoryId
    ? (allCategories.find((c) => c.id === lead.leadCategoryId)?.name ?? null)
    : null;

  const ownerName = allUsers.find((u) => u.id === lead.ownerId)?.name ?? null;
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const initials = [lead.firstName?.[0], lead.lastName?.[0]].filter(Boolean).join("").toUpperCase();
  const hasContactInfo = !!(lead.email || lead.phone || lead.mobile || lead.website);
  const hasAddressInfo = !!(lead.street || lead.city || lead.state || lead.zipCode || lead.country);
  const hasCompanyInfo = !!(lead.companyName || lead.jobTitle || lead.industry);
  // The mobile first: it is the number that reaches the person rather than a desk.
  const callNumber = lead.mobile || lead.phone;
  const pagePath = `/dashboard/leads/${leadId}`;

  // ⚠️ The badge used to print the raw status ("contacting") in both languages.
  // A converted lead's status is "converted", which is not among the statuses the
  // edit form offers, so it has a label of its own.
  const statusLabel = (s: string) =>
    s === "converted" ? t("converted") : t.has(`statuses.${s}` as never) ? t(`statuses.${s}` as never) : s;
  const ratingLabel = (r: string) => (t.has(`ratings.${r}` as never) ? t(`ratings.${r}` as never) : r);
  // The workspace's own name for it, else the built-in label (src/lib/record-sources.ts).
  const sourceLabel = await sourceLabeller(db);
  const status = lead.isConverted ? "converted" : lead.status;
  const rating = lead.rating ? RATING[lead.rating] : null;

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, leadId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/leads/${leadId}`);
    }
  }

  // ── Derived ──
  const today = dayOf(new Date());
  const daysSince = (d: Date) => Math.max(0, Math.round((today - dayOf(d)) / DAY));
  const ago = (days: number) => (days === 0 ? tR("today") : tR("daysAgo", { days }));
  const shortDate = (d: Date) => format.dateTime(d, { day: "numeric", month: "short", year: "numeric" });

  const createdAt = new Date(lead.createdAt);
  // The timeline also holds the lead's field changes: its count comes from the same place.
  const timelineSummary = await timelineSummaryP;
  const lastContact =
    leadActivities
      .filter((a) => CONTACT_TYPES.has(a.type))
      .map((a) => new Date(a.date ?? a.createdAt))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  // Open tasks first, the most urgent on top; what is done folds away underneath.
  const byDue = (a: (typeof leadTasks)[number], b: (typeof leadTasks)[number]) =>
    (a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY) -
    (b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY);
  const openTasks = leadTasks.filter((tk) => tk.status !== "done").sort(byDue);
  const doneTasks = leadTasks.filter((tk) => tk.status === "done");

  // The next dated step: sorted by due date, so the first open task with one.
  const nextDue = openTasks[0]?.dueDate ? new Date(openTasks[0].dueDate) : null;
  const daysToNext = nextDue ? Math.round((dayOf(nextDue) - today) / DAY) : null;
  const nextOverdue = daysToNext != null && daysToNext < 0;

  const renderTask = (task: (typeof leadTasks)[number]) => {
    const done = task.status === "done";
    const overdue = !done && task.dueDate != null && dayOf(new Date(task.dueDate)) < today;
    return (
      <li key={task.id} className="flex items-start gap-2 py-2 text-sm">
        <TaskDoneButton task={task} canWrite={canWrite} revalidate={`/dashboard/leads/${leadId}`} />
        <div className="min-w-0 flex-1 pt-1.5 max-md:pt-2.5">
          <p className={cn("break-words", done && "text-muted-foreground line-through")}>{task.title}</p>
          {task.description && !done && (
            <p className="line-clamp-2 text-muted-foreground text-xs">{task.description}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
            {task.startDate && !done && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="size-3" aria-hidden />
                {tD("startLabel")} <FormattedDate date={task.startDate} includeTime={!task.allDay} />
              </span>
            )}
            {task.dueDate && (
              <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
                <ClockIcon className="size-3" aria-hidden />
                <FormattedDate date={task.dueDate} includeTime={!task.allDay} />
                {overdue && <span>· {tR("overdue")}</span>}
              </span>
            )}
            {done && task.completedAt && (
              <span className="flex items-center gap-1">
                {tD("completedLabel")} <FormattedDate date={task.completedAt} />
              </span>
            )}
            {!done && PRIORITY_KEY[task.priority] && task.priority !== "normal" && (
              <span className={PRIORITY_STYLES[task.priority]}>{tD(PRIORITY_KEY[task.priority] as never)}</span>
            )}
            {task.assigneeName && (
              <span className="flex min-w-0 items-center gap-1">
                <UserRoundIcon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{task.assigneeName}</span>
              </span>
            )}
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center">
            <TaskModal task={task} users={allUsers} revalidatePathStr={pagePath} />
            <form
              action={async () => {
                "use server";
                await deleteTask(task.id, `/dashboard/leads/${leadId}`);
              }}
            >
              <button
                type="submit"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive max-md:size-10"
                title={tc("delete")}
                aria-label={tc("delete")}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </form>
          </div>
        )}
      </li>
    );
  };

  // ── Sections ──
  const nextSteps = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tD("tasksNextStepsTitle")}</CardTitle>
        <span className="text-muted-foreground text-xs">{tP("openTasksCount", { count: openTasks.length })}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          /* The task form has a title, a description, a priority, two dates and
             an assignee: about 300px open. Folded, the list it adds to comes
             first on a phone, and the form is still one tap away. */
          <details className="group/new rounded-md border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-sm [&::-webkit-details-marker]:hidden">
              <PlusIcon className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">{tD("createTask")}</span>
              <ChevronDownIcon
                className="size-4 text-muted-foreground transition-transform group-open/new:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="border-t p-2">
              <QuickTaskForm entityType="lead" entityId={leadId} userId={userId ?? ""} />
            </div>
          </details>
        )}

        {openTasks.length === 0 ? (
          <EmptyHint>{tX("noOpenTasks")}</EmptyHint>
        ) : (
          <>
            <ul className="divide-y">{openTasks.slice(0, TASKS_SHOWN).map(renderTask)}</ul>
            {openTasks.length > TASKS_SHOWN && (
              <details className="group/more">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
                  {tR("showMore")}
                  <span className="tabular-nums">({openTasks.length - TASKS_SHOWN})</span>
                  <ChevronDownIcon className="size-4 transition-transform group-open/more:rotate-180" aria-hidden />
                </summary>
                <ul className="divide-y border-t">{openTasks.slice(TASKS_SHOWN).map(renderTask)}</ul>
              </details>
            )}
          </>
        )}

        {doneTasks.length > 0 && (
          <details className="group/done rounded-md border">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
              {tX("completedTasks", { count: doneTasks.length })}
              <ChevronDownIcon className="size-4 transition-transform group-open/done:rotate-180" aria-hidden />
            </summary>
            <ul className="divide-y border-t px-1">{doneTasks.map(renderTask)}</ul>
          </details>
        )}
      </CardContent>
    </Card>
  );

  const activity = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tD("timelineTitle")}</CardTitle>
        <span className="text-muted-foreground text-xs tabular-nums">{timelineSummary.count}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          /* On a phone the note takes the first line on its own and the type
             and the button share the second: three controls in one 280px row
             leave the note about 120px to be typed into. */
          <RecordComposer label={tD("logActivity")} icon={<PlusIcon aria-hidden />}>
            <form action={handleAddActivity} className="flex flex-wrap gap-2 border-b pb-3 sm:flex-nowrap">
              <select
                name="type"
                aria-label={tD("typeLabel")}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm max-sm:h-11 max-sm:flex-1"
              >
                <option value="note">{tD("activityTypes.note")}</option>
                <option value="call">{tD("activityTypes.call")}</option>
                <option value="meeting">{tD("activityTypes.meeting")}</option>
              </select>
              <Textarea
                name="content"
                required
                aria-label={tD("activityPlaceholder")}
                placeholder={tD("activityPlaceholder")}
                className="h-9 min-h-[36px] flex-1 resize-none py-1.5 max-sm:order-first max-sm:h-11 max-sm:min-h-11 max-sm:basis-full md:text-sm"
              />
              <Button type="submit" size="sm" className="max-sm:h-11">
                {tD("logActivity")}
              </Button>
            </form>
          </RecordComposer>
        )}

        <RecordTimeline scope={{ type: "lead", id: leadId }} revalidatePathStr={pagePath} canWrite={canWrite} />
      </CardContent>
    </Card>
  );

  const contactCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tD("sectionContactInfo")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasContactInfo ? (
          <FieldList>
            <Field label={tD("fieldEmail")}>
              {lead.email && (
                <EmailAddressButton
                  email={lead.email}
                  entity={lead}
                  entityType="lead"
                  templates={templates}
                  ownerId={userId}
                  ai={ai.draft ?? null}
                  canSend={canWrite}
                  className="break-all text-primary hover:underline"
                />
              )}
            </Field>
            <Field label={tD("fieldPhone")}>
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="text-primary hover:underline">
                  {lead.phone}
                </a>
              )}
            </Field>
            <Field label={tD("fieldMobile")}>
              {lead.mobile && (
                <a href={`tel:${lead.mobile}`} className="text-primary hover:underline">
                  {lead.mobile}
                </a>
              )}
            </Field>
            <Field label={tD("fieldWebsite")}>
              {lead.website && (
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-primary hover:underline"
                >
                  {lead.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </Field>
          </FieldList>
        ) : (
          <p className="text-muted-foreground text-sm">{tD("notApplicable")}</p>
        )}

        {hasCompanyInfo && (
          <section className="space-y-2 border-t pt-3">
            <SubHeading icon={<BuildingIcon aria-hidden />}>{tD("sectionCompanyInfo")}</SubHeading>
            <FieldList>
              <Field label={tD("fieldCompany")}>{lead.companyName}</Field>
              <Field label={tD("fieldJobTitle")}>{lead.jobTitle}</Field>
              <Field label={tD("fieldIndustry")}>{lead.industry}</Field>
            </FieldList>
          </section>
        )}

        {hasAddressInfo && (
          <section className="space-y-2 border-t pt-3">
            <SubHeading icon={<MapPinIcon aria-hidden />}>{tD("sectionAddress")}</SubHeading>
            <address className="space-y-0.5 text-sm not-italic">
              {lead.street && <p>{lead.street}</p>}
              {(lead.city || lead.state || lead.zipCode) && (
                <p>{[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}</p>
              )}
              {lead.country && <p>{lead.country}</p>}
            </address>
          </section>
        )}
      </CardContent>
    </Card>
  );

  const qualificationCard = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tD("sectionQualification")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={tD("fieldStatus")} always>
            <StatusBadge tone={STATUS_TONE[status] ?? "neutral"}>{statusLabel(status)}</StatusBadge>
          </Field>
          <Field label={tD("fieldRating")}>
            {lead.rating && (
              <StatusBadge tone={rating?.tone ?? "neutral"}>
                {rating?.icon}
                {ratingLabel(lead.rating)}
              </StatusBadge>
            )}
          </Field>
          <Field label={tD("fieldSource")}>{lead.source && sourceLabel(lead.source)}</Field>
          <Field label={tR("owner")} always>
            {ownerName ?? tR("unassigned")}
          </Field>
          <Field label={t("form.leadType")}>{leadTypeName}</Field>
          <Field label={t("form.leadCategory")}>{leadCategoryName}</Field>
          <Field label={tD("fieldTags")}>
            {lead.tags && lead.tags.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {lead.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </span>
            )}
          </Field>
          {/* Whether the lead may be sent marketing: asked before every
              sequence and campaign, so it stays in view rather than folded. */}
          <Field label={t("detail.marketingConsent")} always>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <StatusBadge tone={lead.marketingConsent ? "success" : "neutral"}>
                {lead.marketingConsent ? tD("marketingAgreed") : tD("marketingNoConsent")}
              </StatusBadge>
              <ConsentDetail granted={lead.marketingConsent} decidedAt={lead.consentDate} source={lead.consentSource} />
            </span>
          </Field>
        </FieldList>

        {lead.notes && (
          <div className="border-t pt-3">
            <p className="mb-1 font-medium text-muted-foreground text-xs">{tR("notes")}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{lead.notes}</p>
          </div>
        )}

        <details className="group/more border-t pt-2">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
            {tR("showMore")}
            <ChevronDownIcon className="size-4 transition-transform group-open/more:rotate-180" aria-hidden />
          </summary>
          <FieldList className="pt-2">
            <Field label={tR("created")}>
              <FormattedDate date={lead.createdAt} />
            </Field>
            <Field label={tR("updated")}>
              <FormattedDate date={lead.updatedAt} />
            </Field>
          </FieldList>
        </details>
      </CardContent>
    </Card>
  );

  // ── The banner a converted lead carries ──
  const convertedLinks = [
    convertedContact && (
      <ConvertedLink
        key="contact"
        href={`/dashboard/contacts/${lead.convertedToContactId}`}
        icon={<UserIcon aria-hidden />}
        caption={t("detail.convertedContact")}
        name={`${convertedContact.firstName} ${convertedContact.lastName}`}
      />
    ),
    convertedCompany && (
      <ConvertedLink
        key="company"
        href={`/dashboard/companies/${lead.convertedToCompanyId}`}
        icon={<BuildingIcon aria-hidden />}
        caption={tD("fieldCompany")}
        name={convertedCompany.name}
      />
    ),
    convertedDeal && (
      <ConvertedLink
        key="deal"
        href={`/dashboard/pipeline/${lead.convertedToDealId}`}
        icon={<BriefcaseIcon aria-hidden />}
        caption={t("detail.convertedDeal")}
        name={convertedDeal.name}
      />
    ),
  ].filter(Boolean);

  return (
    <RecordPage>
      <RecordVisit type="lead" id={leadId} label={fullName || lead.email || leadId} sub={lead.companyName ?? null} />
      <RecordBackLink href="/dashboard/leads">{t("title")}</RecordBackLink>

      {/* ── Hero: who, how warm, where in qualification ── */}
      <RecordHero
        avatar={<RecordAvatar>{initials || <UserIcon className="size-6" />}</RecordAvatar>}
        badges={
          <>
            <StatusBadge tone={STATUS_TONE[status] ?? "neutral"}>
              {lead.isConverted && <CheckCircle2Icon aria-hidden />}
              {statusLabel(status)}
            </StatusBadge>
            {lead.rating && (
              <StatusBadge tone={rating?.tone ?? "neutral"}>
                {rating?.icon}
                {ratingLabel(lead.rating)}
              </StatusBadge>
            )}
            {lead.assistantSince && (
              // Being worked by an AI assistant (src/lib/assistant-handling.ts): Flux's own
              // sequences and campaigns leave this person alone while it lasts.
              <StatusBadge tone="info">
                <BotIcon aria-hidden />
                {tR("withAssistant", {
                  name: lead.assistantName ?? "API",
                  date: format.dateTime(new Date(lead.assistantSince), { day: "numeric", month: "short" }),
                })}
              </StatusBadge>
            )}
          </>
        }
        title={fullName}
        meta={
          <>
            {hasCompanyInfo && (lead.companyName || lead.jobTitle) && (
              <MetaItem
                icon={lead.companyName ? <BuildingIcon aria-hidden /> : <BriefcaseIcon aria-hidden />}
                href={convertedCompany ? `/dashboard/companies/${lead.convertedToCompanyId}` : null}
              >
                {[lead.jobTitle, lead.companyName].filter(Boolean).join(" · ")}
              </MetaItem>
            )}
            {lead.source && <MetaItem icon={<MegaphoneIcon aria-hidden />}>{sourceLabel(lead.source)}</MetaItem>}
            <MetaItem icon={<UserRoundIcon aria-hidden />}>
              {ownerName ? tR("assignedTo", { name: ownerName }) : tR("unassigned")}
            </MetaItem>
          </>
        }
        actions={
          <>
            {callNumber && (
              <Button asChild size="sm" variant="outline">
                <a href={`tel:${callNumber}`}>
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {tR("call")}
                </a>
              </Button>
            )}
            {/* Sending records an activity, so it is a write; and with no
                address the dialog can only refuse. */}
            {canWrite && lead.email && (
              <SendEmailModal entity={lead} entityType="lead" templates={templates} ownerId={userId} ai={ai.draft} />
            )}
            {canWrite &&
              (lead.isConverted ? (
                <LeadModal lead={lead} categories={allCategories} companyTypes={allCompanyTypes}>
                  <Button variant="outline" size="sm">
                    <PencilIcon className="size-3.5" aria-hidden />
                    {tR("edit")}
                  </Button>
                </LeadModal>
              ) : (
                <ConvertLeadButton
                  leadId={lead.id}
                  leadName={fullName}
                  companyName={lead.companyName}
                  activityCount={leadActivities.length}
                  taskCount={leadTasks.length}
                />
              ))}
          </>
        }
      >
        {lead.isConverted && (
          <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            {/* When it happened is the fourth figure in the strip below. */}
            <p className="flex items-center gap-2 font-medium text-emerald-800 text-sm dark:text-emerald-300">
              <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
              {t("detail.convertedTo")}
            </p>
            {convertedLinks.length > 0 ? (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">{convertedLinks}</ul>
            ) : (
              // The records it became can be deleted afterwards; the lead still
              // remembers that it was converted, and says so rather than nothing.
              <p className="text-emerald-800 text-sm dark:text-emerald-300">{t("detail.convertedGone")}</p>
            )}
          </div>
        )}

        {/* The figures that say whether this lead is worth the next call. */}
        <MetricStrip>
          <Metric
            label={t("score")}
            hint={
              lead.leadScore != null && (
                <span className="mt-1 block h-1 w-full max-w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.max(0, lead.leadScore))}%` }}
                  />
                </span>
              )
            }
          >
            {lead.leadScore ?? "—"}
          </Metric>
          <Metric label={tR("created")} hint={shortDate(createdAt)}>
            {ago(daysSince(createdAt))}
          </Metric>
          <Metric label={t("detail.metricLastContact")} hint={lastContact ? shortDate(lastContact) : undefined}>
            {lastContact ? ago(daysSince(lastContact)) : t("detail.neverContacted")}
          </Metric>
          {/* A converted lead's tasks moved to the customer it became, so its
              fourth figure is when that happened. Always four where possible:
              on a phone the strip is two by two, and a missing fourth leaves a
              grey hole in the grid. */}
          {lead.isConverted && lead.convertedAt && (
            <Metric label={t("converted")} hint={shortDate(new Date(lead.convertedAt))}>
              {ago(daysSince(new Date(lead.convertedAt)))}
            </Metric>
          )}
          {!lead.isConverted && (
            <Metric
              label={t("detail.metricNextStep")}
              tone={nextOverdue ? "danger" : undefined}
              hint={
                nextDue && daysToNext != null
                  ? daysToNext === 0
                    ? tR("today")
                    : nextOverdue
                      ? tR("overdueBy", { days: -daysToNext })
                      : tR("inDays", { days: daysToNext })
                  : undefined
              }
            >
              {nextDue ? shortDate(nextDue) : openTasks.length > 0 ? tR("notSet") : t("detail.nothingPlanned")}
            </Metric>
          )}
        </MetricStrip>

        {!lead.isConverted && (LEAD_STEPS as readonly string[]).includes(lead.status) && (
          <div className="border-t pt-4">
            <LeadStatusPath
              leadId={leadId}
              canWrite={canWrite}
              status={lead.status}
              title={tD("sectionQualification")}
              stepOf={t("detail.stepOf", {
                current: LEAD_STEPS.indexOf(lead.status as (typeof LEAD_STEPS)[number]) + 1,
                total: LEAD_STEPS.length,
              })}
              labels={{
                new: statusLabel("new"),
                contacting: statusLabel("contacting"),
                engaged: statusLabel("engaged"),
                qualified: statusLabel("qualified"),
              }}
            />
          </div>
        )}

        {/* The rarer actions, under the figures rather than beside the name: the
            hero keeps three buttons, and the bin is not next to Convert. */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {!lead.isConverted && (
              <LeadModal lead={lead} categories={allCategories} companyTypes={allCompanyTypes}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="size-3.5" aria-hidden />
                  {tR("edit")}
                </Button>
              </LeadModal>
            )}
            {hasMarketing && !lead.isConverted && <EnrollInSequence entity="lead" recordId={lead.id} />}
            <div className="ml-auto">
              <DeleteLeadButton lead={lead} redirectTo="/dashboard/leads" />
            </div>
          </div>
        )}
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "next", label: tR("tabs.nextSteps"), icon: <ListChecksIcon aria-hidden />, count: openTasks.length },
          {
            id: "activity",
            label: tR("tabs.activity"),
            icon: <ClockIcon aria-hidden />,
            count: timelineSummary.count,
          },
          { id: "details", label: tR("tabs.details"), icon: <InfoIcon aria-hidden /> },
          { id: "documents", label: tR("tabs.documents"), icon: <FileTextIcon aria-hidden /> },
        ]}
        sections={[
          { tab: "next", column: "main", node: nextSteps },
          { tab: "activity", column: "main", node: activity },
          ...(ai.summary
            ? [
                {
                  tab: "activity",
                  column: "side" as const,
                  node: <AiSummaryCard subject={{ type: "lead", id: leadId }} entry={ai.summary} />,
                },
              ]
            : []),
          { tab: "details", column: "side", node: contactCard },
          { tab: "details", column: "side", node: qualificationCard },
          {
            tab: "details",
            column: "side",
            node: (
              <CustomFieldsPanel
                entityType="lead"
                entityId={leadId}
                definitions={customFieldDefs}
                values={customFieldVals}
              />
            ),
          },
          { tab: "documents", column: "side", node: <DocumentPanel entityType="lead" entityId={leadId} /> },
          ...(can(session?.user?.tenantRole ?? null, "privacy:manage")
            ? [
                {
                  tab: "details" as const,
                  column: "side" as const,
                  node: (
                    <PrivacyCard
                      contactPoint={lead.email ?? lead.phone ?? lead.mobile ?? null}
                      listPath="/dashboard/leads"
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
    </RecordPage>
  );
}

/** One record the lead became: what kind, and its name, the whole tile a link. */
function ConvertedLink({
  href,
  icon,
  caption,
  name,
}: {
  href: string;
  icon: ReactNode;
  caption: string;
  name: string;
}) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className="flex min-h-11 items-center gap-2.5 rounded-md border bg-background px-3 py-2 transition-colors hover:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      >
        {icon}
        <span className="min-w-0">
          <span className="block text-muted-foreground text-xs">{caption}</span>
          <span className="block truncate font-medium text-sm">{name}</span>
        </span>
      </Link>
    </li>
  );
}

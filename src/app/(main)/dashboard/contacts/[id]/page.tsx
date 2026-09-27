import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import {
  BotIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  InfoIcon,
  LinkedinIcon,
  ListChecksIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  SmartphoneIcon,
  StarIcon,
  Trash2Icon,
  UserIcon,
  UserRoundIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { createActivity } from "@/actions/activities";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getCustomerRecord } from "@/actions/customer-record";
import { getEmailTemplates } from "@/actions/marketing";
import { deleteTask, getAllUsers, getTasksByContact } from "@/actions/tasks";
import { ContactModal } from "@/app/(main)/dashboard/contacts/_components/contact-modal";
import { auth } from "@/auth";
import { ActivityModal } from "@/components/crm/activity-modal";
import { ConsentDetail } from "@/components/crm/consent-detail";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { CustomerRecordPanel } from "@/components/crm/customer-record";
import { DocumentPanel } from "@/components/crm/document-panel";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { companies, contacts } from "@/db/schema";
import { getTenantEntitlements } from "@/lib/auth-guard";
import { can } from "@/lib/permissions";
import { recordTimelineSummary } from "@/lib/record-timeline";
import { getDb } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";

import { OpenDealsValue } from "./_components/open-deals-value";

const DAY = 86_400_000;

/** How many rows a list shows before the rest folds away behind "show more". */
const FIRST = 5;

const STATUS_TONE: Record<string, Tone> = { active: "success", inactive: "neutral" };

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

/** Midnight of a date, so "due today" does not turn overdue at 9am. */
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A link in a field row: a thumb's height on a phone, one text line from md up. */
const TAP_LINK = "inline-flex max-w-full items-center gap-1.5 text-primary hover:underline max-md:min-h-11";

/**
 * One person, laid out for whoever has to talk to them next.
 *
 * ⚠️ Built on the deal page's model (src/components/crm/record/): the hero says
 * who they are and puts the three everyday gestures — call, write, edit — under
 * the thumb; the figures say whether anything is waiting (a task due, deals open,
 * how long since anyone spoke to them); the work column is what gets done today
 * (the next steps, then the timeline, email history included); the reference
 * column is everything looked up rather than acted on. The previous page opened
 * on a phone with four cards of read-only fields and put the tasks last, below
 * a timeline of every activity the contact ever had.
 */
export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  // The workspace role, never `session.user.role` (Flux's own staff scale, see
  // CLAUDE.md). A viewer reads the contact; the controls that would only answer
  // "forbidden" are not drawn for them.
  const tenantRole = session?.user?.tenantRole ?? null;
  const canWrite = can(tenantRole, "record:write");
  const db = await getDb();
  // Sequences belong to the marketing module: without it the button opens a
  // dialog whose every action is refused by the server.
  const hasMarketing = (await getTenantEntitlements().catch(() => null))?.enabledModules?.includes("marketing") ?? true;

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

  const [
    timelineSummary,
    tasksList,
    allUsers,
    customFieldDefs,
    customFieldVals,
    record,
    t,
    tD,
    tR,
    tX,
    tP,
    tC,
    format,
  ] = await Promise.all([
    // What the timeline holds — this person's and their deals' — for the tab's count and
    // the last contact, so neither disagrees with the list.
    recordTimelineSummary(db, { type: "contact", id: contactId }),
    getTasksByContact(contactId),
    getAllUsers(),
    getCustomFieldDefinitions("contact"),
    getCustomFieldValues("contact", contactId),
    // What this person has been sold, which is what a customer page is opened for.
    getCustomerRecord({ contactId }),
    getTranslations("contacts"),
    getTranslations("entityDetail"),
    getTranslations("record"),
    getTranslations("pipeline.detail"),
    getTranslations("pipeline"),
    getTranslations("contacts.detail"),
    getFormatter(),
  ]);
  const tc = await getTranslations("common");

  // ── Server actions scoped to this contact ──
  const pagePath = `/dashboard/contacts/${contactId}`;

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, contactId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/contacts/${contactId}`);
    }
  }

  // ── Derived ──
  const now = new Date();
  const today = dayOf(now);
  const ownerName = allUsers.find((u) => u.id === cData.ownerId)?.name ?? null;
  const fullName = [cData.firstName, cData.lastName].filter(Boolean).join(" ");
  const initials = [cData.firstName?.[0], cData.lastName?.[0]].filter(Boolean).join("").toUpperCase();
  const role = [cData.jobTitle, cData.department].filter(Boolean).join(" · ");
  // The mobile first: it is the number that reaches the person rather than a desk.
  const callNumber = cData.mobile || cData.phone;
  const statusLabel = t.has(`statuses.${cData.status}` as never)
    ? t(`statuses.${cData.status}` as never)
    : cData.status;
  const sourceLabel =
    cData.source && t.has(`sources.${cData.source}` as never) ? t(`sources.${cData.source}` as never) : cData.source;
  const address = [
    cData.street,
    [cData.zipCode, cData.city, cData.state].filter(Boolean).join(" "),
    cData.country,
  ].filter(Boolean);

  // A timed task is late the minute it passes; an all-day one only once its day has.
  const isOverdue = (task: (typeof tasksList)[number]) =>
    task.status !== "done" &&
    task.dueDate != null &&
    (task.allDay ? dayOf(new Date(task.dueDate)) < today : new Date(task.dueDate) < now);

  // Open tasks first, the most urgent on top; what is done folds away underneath.
  const byDue = (a: (typeof tasksList)[number], b: (typeof tasksList)[number]) =>
    (a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY) -
    (b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY);
  const openTasks = tasksList.filter((tk) => tk.status !== "done").sort(byDue);
  const doneTasks = tasksList.filter((tk) => tk.status === "done");

  // The next thing due, and how far away it is: "14 Oct" asks the reader to work
  // out whether that is next week or last week, and last week is what needs acting on.
  const nextDue = openTasks.find((tk) => tk.dueDate != null) ?? null;
  const nextDueDate = nextDue?.dueDate ? new Date(nextDue.dueDate) : null;
  const daysToNext = nextDueDate ? Math.round((dayOf(nextDueDate) - today) / DAY) : null;
  const nextOverdue = nextDue ? isOverdue(nextDue) : false;

  // When anyone last dealt with them — on this contact or on any of their deals — counting
  // only what has happened, not a meeting booked for next week.
  const lastActivity = timelineSummary.lastContactAt;
  const daysSinceActivity = lastActivity ? Math.max(0, Math.round((today - dayOf(lastActivity)) / DAY)) : null;

  // ⚠️ The open-deals figure is only drawn when it is the whole truth.
  // `getCustomerRecord` reads the five newest deals and a sixth to know there are
  // more; with more, a sum of the five would be a plausible, wrong number. An
  // exact count would need a query of its own, which this page does not add.
  const openDeals = record.deals.filter((d) => d.status === "open");
  const openDealsExact = !record.more.deals;
  const openDealsValue = openDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const salesCount = record.deals.length + record.quotes.length + record.orders.length + record.tickets.length;
  const salesCapped = record.more.deals || record.more.quotes || record.more.orders || record.more.tickets;

  const renderTask = (task: (typeof tasksList)[number]) => {
    const done = task.status === "done";
    const overdue = isOverdue(task);
    return (
      <li key={task.id} className="flex items-start gap-2 py-2 text-sm">
        <TaskDoneButton task={task} canWrite={canWrite} revalidate={`/dashboard/contacts/${contactId}`} />
        <div className="min-w-0 flex-1 pt-1.5 max-md:pt-2.5">
          <p className={cn("break-words font-medium", done && "font-normal text-muted-foreground line-through")}>
            {task.title}
          </p>
          {task.description && !done && (
            <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground text-xs">{task.description}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
            {task.dueDate && !done && (
              <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
                <ClockIcon className="size-3" aria-hidden />
                <FormattedDate date={task.dueDate} includeTime={!task.allDay} />
                {overdue && <span>· {tX("overdue")}</span>}
              </span>
            )}
            {task.startDate && !done && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="size-3" aria-hidden />
                {tD("startLabel")} <FormattedDate date={task.startDate} includeTime={!task.allDay} />
              </span>
            )}
            {done && task.completedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle2Icon className="size-3" aria-hidden />
                {tD("completedLabel")} <FormattedDate date={task.completedAt} />
              </span>
            )}
            {!done && PRIORITY_KEY[task.priority] && task.priority !== "normal" && (
              <span className={PRIORITY_STYLES[task.priority]}>{tD(PRIORITY_KEY[task.priority] as never)}</span>
            )}
            <span className="flex min-w-0 items-center gap-1">
              <UserRoundIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{task.assigneeName || tD("myself")}</span>
            </span>
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center">
            <TaskModal task={task} users={allUsers} revalidatePathStr={pagePath} />
            <form
              action={async () => {
                "use server";
                await deleteTask(task.id, `/dashboard/contacts/${contactId}`);
              }}
            >
              <button
                type="submit"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive max-md:size-9"
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

  /** The rest of a long list, folded: the first few are what is read, the others are one tap away. */
  const Folded = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <details className="group/more rounded-md border">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground max-md:min-h-11 [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open/more:rotate-180" aria-hidden />
      </summary>
      <div className="border-t p-2">{children}</div>
    </details>
  );

  // ── Sections ──
  const nextSteps = (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{tD("tasksNextStepsTitle")}</CardTitle>
          <p className="text-muted-foreground text-xs">{tP("openTasksCount", { count: openTasks.length })}</p>
        </div>
        {/* A sequence is a plan of next steps that runs itself, so enrolling sits
            beside the tasks rather than among the hero's everyday actions. */}
        {canWrite && hasMarketing && <EnrollInSequence entity="contact" recordId={cData.id} />}
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          <RecordComposer label={tD("createTask")} icon={<PlusIcon aria-hidden />}>
            <QuickTaskForm entityType="contact" entityId={contactId} userId={userId ?? ""} />
          </RecordComposer>
        )}

        {openTasks.length === 0 ? (
          <EmptyHint>{tX("noOpenTasks")}</EmptyHint>
        ) : (
          <ul className="divide-y">{openTasks.slice(0, FIRST).map(renderTask)}</ul>
        )}
        {openTasks.length > FIRST && (
          <Folded label={tC("moreTasks", { count: openTasks.length - FIRST })}>
            <ul className="divide-y">{openTasks.slice(FIRST).map(renderTask)}</ul>
          </Folded>
        )}

        {doneTasks.length > 0 && (
          <Folded label={tX("completedTasks", { count: doneTasks.length })}>
            <ul className="divide-y">{doneTasks.map(renderTask)}</ul>
          </Folded>
        )}
      </CardContent>
    </Card>
  );

  // Every email sent from here is an activity of type "email", so the timeline is
  // also the email history; there is no second list to keep in step with it.
  const activity = (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{tD("timelineTitle")}</CardTitle>
        {canWrite && (
          <ActivityModal
            mode="create"
            entityType="contact"
            entityId={contactId}
            ownerId={userId}
            revalidatePathStr={pagePath}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          /* On a phone the note takes the first line on its own and the type
             and the button share the second: three controls in one 280px row
             left the note about 120px to be typed into. */
          <RecordComposer label={tD("logActivity")} icon={<PlusIcon aria-hidden />}>
            <form action={handleAddActivity} className="flex flex-wrap gap-2 sm:flex-nowrap">
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
                {tP("logBtn")}
              </Button>
            </form>
          </RecordComposer>
        )}

        {/* Pages of its own, with "load more", in place of the first five and a fold. */}
        <RecordTimeline scope={{ type: "contact", id: contactId }} revalidatePathStr={pagePath} canWrite={canWrite} />
      </CardContent>
    </Card>
  );

  const contactInfo = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tD("sectionContactInfo")}</CardTitle>
      </CardHeader>
      <CardContent>
        {cData.email || cData.phone || cData.mobile || cData.linkedinUrl ? (
          <FieldList>
            <Field label={tD("fieldEmail")}>
              {cData.email && (
                <a href={`mailto:${cData.email}`} className={TAP_LINK}>
                  <MailIcon className="size-3.5 shrink-0" aria-hidden />
                  <span className="break-all">{cData.email}</span>
                </a>
              )}
            </Field>
            <Field label={tD("fieldMobile")}>
              {cData.mobile && (
                <a href={`tel:${cData.mobile}`} className={TAP_LINK}>
                  <SmartphoneIcon className="size-3.5 shrink-0" aria-hidden />
                  {cData.mobile}
                </a>
              )}
            </Field>
            <Field label={tD("fieldPhone")}>
              {cData.phone && (
                <a href={`tel:${cData.phone}`} className={TAP_LINK}>
                  <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
                  {cData.phone}
                </a>
              )}
            </Field>
            <Field label={tD("fieldLinkedIn")}>
              {cData.linkedinUrl && (
                <a href={cData.linkedinUrl} target="_blank" rel="noopener noreferrer" className={TAP_LINK}>
                  <LinkedinIcon className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{tD("fieldLinkedIn")}</span>
                </a>
              )}
            </Field>
          </FieldList>
        ) : (
          <EmptyHint>{tC("noContactInfo")}</EmptyHint>
        )}
      </CardContent>
    </Card>
  );

  const details = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("detailsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={tD("fieldCompany")} always>
            {cData.companyId && companyName ? (
              <Link href={`/dashboard/companies/${cData.companyId}`} className={TAP_LINK}>
                <BuildingIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{companyName}</span>
              </Link>
            ) : (
              <span className="text-muted-foreground">{tD("noCompanyLinked")}</span>
            )}
          </Field>
          <Field label={tD("fieldJobTitle")}>{cData.jobTitle}</Field>
          <Field label={tD("fieldDepartment")}>{cData.department}</Field>
          <Field label={tD("fieldOwner")} always>
            {ownerName ?? tR("unassigned")}
          </Field>
          <Field label={tD("fieldStatus")}>
            <StatusBadge tone={STATUS_TONE[cData.status] ?? "neutral"}>{statusLabel}</StatusBadge>
          </Field>
          <Field label={tD("fieldScore")}>
            {cData.leadScore != null && (
              <span className="flex items-center gap-2">
                <Progress value={cData.leadScore} className="h-2 max-w-32 flex-1" />
                <span className="font-semibold tabular-nums">{cData.leadScore}</span>
              </span>
            )}
          </Field>
          <Field label={tD("fieldSource")}>{sourceLabel}</Field>
          <Field label={tD("fieldTags")}>
            {cData.tags && cData.tags.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {cData.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </span>
            )}
          </Field>
          <Field label={tC("fieldMarketing")} always>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusBadge tone={cData.marketingConsent ? "success" : "neutral"}>
                {cData.marketingConsent ? tD("marketingAgreed") : tD("marketingNoConsent")}
              </StatusBadge>
              <ConsentDetail
                granted={cData.marketingConsent}
                decidedAt={cData.consentDate}
                source={cData.consentSource}
              />
            </span>
          </Field>
          <Field label={tD("sectionAddress")}>
            {address.length > 0 && (
              <address className="not-italic">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            )}
          </Field>
        </FieldList>

        {/* Dates are looked up, not read: folded, like every rarely used field. */}
        <details className="group/dates">
          <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground text-xs hover:text-foreground max-md:min-h-11 [&::-webkit-details-marker]:hidden">
            <span className="group-open/dates:hidden">{tR("showMore")}</span>
            <span className="hidden group-open/dates:inline">{tR("showLess")}</span>
            <ChevronDownIcon className="size-3.5 transition-transform group-open/dates:rotate-180" aria-hidden />
          </summary>
          <FieldList className="pt-2">
            <Field label={tR("created")}>
              <FormattedDate date={cData.createdAt} />
            </Field>
            <Field label={tR("updated")}>
              <FormattedDate date={cData.updatedAt} />
            </Field>
          </FieldList>
        </details>

        <div className="border-t pt-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs">{tD("fieldNotes")}</p>
          {cData.notes ? (
            <p className="whitespace-pre-wrap break-words text-sm">{cData.notes}</p>
          ) : (
            <p className="text-muted-foreground text-sm">—</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <RecordPage>
      <RecordVisit
        type="contact"
        id={contactId}
        label={fullName || cData.email || contactId}
        sub={cData.email ?? null}
      />
      <RecordBackLink href="/dashboard/contacts">{t("title")}</RecordBackLink>

      {/* ── Hero: who they are, where they work, how to reach them ── */}
      <RecordHero
        avatar={<RecordAvatar>{initials || <UserIcon className="size-6" />}</RecordAvatar>}
        badges={
          <>
            <StatusBadge tone={STATUS_TONE[cData.status] ?? "neutral"}>{statusLabel}</StatusBadge>
            {cData.leadScore != null && (
              <StatusBadge tone={cData.leadScore >= 70 ? "success" : cData.leadScore >= 40 ? "warning" : "neutral"}>
                <StarIcon aria-hidden />
                {tD("fieldScore")}: {cData.leadScore}
              </StatusBadge>
            )}
            {cData.assistantSince && (
              // Being worked by an AI assistant (src/lib/assistant-handling.ts): Flux's own
              // sequences and campaigns leave this person alone while it lasts.
              <StatusBadge tone="info">
                <BotIcon aria-hidden />
                {tR("withAssistant", {
                  name: cData.assistantName ?? "API",
                  date: format.dateTime(new Date(cData.assistantSince), { day: "numeric", month: "short" }),
                })}
              </StatusBadge>
            )}
          </>
        }
        title={fullName || cData.email || tR("notSet")}
        meta={
          <>
            {role && <MetaItem icon={<BriefcaseIcon aria-hidden />}>{role}</MetaItem>}
            {companyName && (
              <MetaItem
                icon={<BuildingIcon aria-hidden />}
                href={cData.companyId ? `/dashboard/companies/${cData.companyId}` : null}
              >
                {companyName}
              </MetaItem>
            )}
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
            {/* Sending logs an activity and needs write access; without an address
                the dialog could only answer that there is nowhere to send it. */}
            {canWrite && cData.email && (
              <SendEmailModal entity={cData} entityType="contact" templates={templates} ownerId={userId} />
            )}
            {canWrite && (
              <ContactModal contact={cData}>
                <Button variant="outline" size="sm">
                  <PencilIcon className="size-3.5" aria-hidden />
                  {tR("edit")}
                </Button>
              </ContactModal>
            )}
          </>
        }
      >
        {/* Whether anything is waiting on this person. */}
        <MetricStrip>
          <Metric
            label={tC("metricNextDue")}
            tone={nextOverdue ? "danger" : undefined}
            hint={
              daysToNext != null
                ? nextOverdue
                  ? daysToNext < 0
                    ? tR("overdueBy", { days: -daysToNext })
                    : tR("overdue")
                  : daysToNext === 0
                    ? tR("today")
                    : tR("inDays", { days: daysToNext })
                : undefined
            }
          >
            {nextDueDate
              ? format.dateTime(nextDueDate, { day: "numeric", month: "short" })
              : openTasks.length > 0
                ? tR("notSet")
                : "—"}
          </Metric>
          <Metric
            label={tC("metricLastActivity")}
            hint={
              lastActivity
                ? format.dateTime(lastActivity, { day: "numeric", month: "short", year: "numeric" })
                : undefined
            }
          >
            {daysSinceActivity == null
              ? "—"
              : daysSinceActivity === 0
                ? tR("today")
                : tR("daysAgo", { days: daysSinceActivity })}
          </Metric>
          {openDealsExact && (
            <Metric label={tC("metricOpenDeals")} hint={tC("dealsCount", { count: openDeals.length })}>
              <OpenDealsValue value={openDealsValue} />
            </Metric>
          )}
        </MetricStrip>
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "next", label: tR("tabs.nextSteps"), icon: <ListChecksIcon aria-hidden />, count: openTasks.length },
          { id: "activity", label: tR("tabs.activity"), icon: <ClockIcon aria-hidden />, count: timelineSummary.count },
          { id: "details", label: tR("tabs.details"), icon: <InfoIcon aria-hidden /> },
          {
            id: "sales",
            label: tR("tabs.sales"),
            icon: <FileTextIcon aria-hidden />,
            // Five of each are loaded; a count of the loaded rows would understate
            // a busy customer, so none is shown rather than a wrong one.
            count: salesCapped ? undefined : salesCount,
          },
        ]}
        sections={[
          { tab: "next", column: "main", node: nextSteps },
          { tab: "activity", column: "main", node: activity },
          { tab: "details", column: "side", node: contactInfo },
          { tab: "details", column: "side", node: details },
          {
            tab: "details",
            column: "side",
            node: (
              <CustomFieldsPanel
                entityType="contact"
                entityId={contactId}
                definitions={customFieldDefs}
                values={customFieldVals}
              />
            ),
          },
          {
            tab: "sales",
            column: "side",
            node: <CustomerRecordPanel record={record} contactId={contactId} canWrite={canWrite} />,
          },
          { tab: "sales", column: "side", node: <DocumentPanel entityType="contact" entityId={contactId} /> },
          ...(can(tenantRole, "privacy:manage")
            ? [
                {
                  tab: "details" as const,
                  column: "side" as const,
                  node: (
                    <PrivacyCard
                      contactPoint={cData.email ?? cData.phone ?? cData.mobile ?? null}
                      listPath="/dashboard/contacts"
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

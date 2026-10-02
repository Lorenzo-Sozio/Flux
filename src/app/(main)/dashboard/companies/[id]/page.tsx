import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";

import { and, asc, eq, sql } from "drizzle-orm";
import {
  BuildingIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  GlobeIcon,
  InfoIcon,
  ListChecksIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ReceiptIcon,
  Trash2Icon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { createActivity } from "@/actions/activities";
import { getCompanyCategories, getCompanyTypes } from "@/actions/crm";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getCustomerRecord } from "@/actions/customer-record";
import { getPriceListsForSelect } from "@/actions/price-lists";
import { getCustomerMoney } from "@/actions/receipts";
import { deleteTask, getAllUsers, getTasksByCompany } from "@/actions/tasks";
import { CompanyModal } from "@/app/(main)/dashboard/companies/_components/company-modal";
import { DealAmount } from "@/app/(main)/dashboard/pipeline/[id]/_components/deal-amount";
import { CashError } from "@/app/(main)/dashboard/sales/finance/_components/cash-error";
import { auth } from "@/auth";
import { AiSummaryCard } from "@/components/crm/ai/ai-summary-card";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { CustomerMoneyCard } from "@/components/crm/customer-money-card";
import { CustomerRecordPanel } from "@/components/crm/customer-record";
import { DocumentPanel } from "@/components/crm/document-panel";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { FormattedDate } from "@/components/crm/formatted-date";
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
import { TaskDoneButton } from "@/components/crm/task-done-button";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { companies, contacts, deals, tickets } from "@/db/schema";
import { aiEntries, aiViewer } from "@/lib/ai/access";
import { customerGaps } from "@/lib/fiscal-ids";
import { failed, loadedValue, loadOutcome } from "@/lib/load-outcome";
import { can } from "@/lib/permissions";
import { sourceLabeller } from "@/lib/record-sources-load";
import { recordTimelineSummary } from "@/lib/record-timeline";
import { recordScope, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

/** How many people are drawn before the rest fold behind "Show more". */
const PEOPLE_VISIBLE = 5;
/** How many are read at all; the count beyond it comes from the same statement. */
const PEOPLE_LOADED = 100;

// The shared tones: a customer is the good outcome, a prospect is work in
// progress, and a partner or a vendor is a relationship rather than a state.
const TYPE_TONE: Record<string, Tone> = { customer: "success", prospect: "info" };

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

const externalUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/**
 * One company, laid out for the person who looks after the account.
 *
 * ⚠️ Same order as the deal page, because it is the same order of questions: what
 * is this account worth and is anything wrong with it (the figures), what do I do
 * next (the tasks), who do I talk to there (the people), what has happened (the
 * timeline). The reference material — addresses, billing codes, custom fields,
 * the commercial record, the files — sits in the side column on a desktop and in
 * its own tabs on a phone. The previous layout put four cards of read-only fields
 * first and had nowhere at all for the people who work at the company.
 */
export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  // The workspace role, never `session.user.role` — see CLAUDE.md on the two scales.
  const tenantRole = session?.user?.tenantRole ?? null;
  // A viewer reads the account; controls that would only answer "forbidden" are
  // not drawn for them.
  const canWrite = can(tenantRole, "record:write");
  // ⚠️ Started together and awaited where used: the company row, the copilot's entry and the
  // page's reads used to wait for one another before the page could draw.
  const aiP: ReturnType<typeof aiEntries<"summary">> = canWrite
    ? aiEntries(["summary"] as const, aiViewer(session?.user))
    : Promise.resolve({});
  const db = await getDb();
  // The workspace's own name for a source, else the built-in label (src/lib/record-sources.ts).
  const sourceLabelP = sourceLabeller(db);
  // A colleague's account is not found, rather than refused; on one seen through a deal of one's
  // own, the people and the figures are only those one may see (src/lib/record-visibility.ts).
  const scope = await recordScope();
  const companyP = db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), visibleWhere("company", scope)))
    .then((rows) => rows[0]);
  const restP = Promise.all([
    // What the timeline holds — the company's own, its contacts' and its deals' — for the
    // tab's count and the last contact, so neither disagrees with the list.
    recordTimelineSummary(db, { type: "company", id: companyId }),
    getTasksByCompany(companyId),
    getAllUsers(),
    getCustomFieldDefinitions("company"),
    getCustomFieldValues("company", companyId),
    // What has been sold here, which is what a business opens a customer for.
    getCustomerRecord({ companyId }),
    getCompanyCategories().catch(() => []),
    getCompanyTypes().catch(() => []),
    // The list this customer is on comes back even if it has been retired: a screen
    // that hides it says "no price list" about a customer who has one.
    companyP.then((c) => (c ? getPriceListsForSelect(c.priceListId).catch(() => []) : [])),
    // The people who work here. A company page with no way to reach anybody at
    // the company sent the reader to the contacts list and a search box.
    // `count(*) over ()` carries the total in the same statement, so a company
    // with four hundred contacts reads a hundred rows and still says how many.
    db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        jobTitle: contacts.jobTitle,
        email: contacts.email,
        phone: contacts.phone,
        mobile: contacts.mobile,
        total: sql<number>`(count(*) over ())::int`,
      })
      .from(contacts)
      .where(and(eq(contacts.companyId, companyId), visibleWhere("contact", scope)))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName))
      .limit(PEOPLE_LOADED),
    // ⚠️ The figures are one aggregate over every deal, not a sum of the rows the
    // commercial record shows: that panel reads five, and a total built from five
    // is a wrong number that looks exactly like a right one. An aggregate with no
    // GROUP BY always answers one row, so a company with no deals reads zeros.
    // Deal amounts are EUR at rest, which is what `DealAmount` expects.
    db
      .select({
        openValue: sql<string>`coalesce(sum(${deals.amount}) filter (where ${deals.status} = 'open'), 0)`,
        openCount: sql<number>`(count(*) filter (where ${deals.status} = 'open'))::int`,
        wonValue: sql<string>`coalesce(sum(${deals.amount}) filter (where ${deals.status} = 'won'), 0)`,
        wonCount: sql<number>`(count(*) filter (where ${deals.status} = 'won'))::int`,
        openTickets: sql<number>`(select count(*)::int from ${tickets} where ${tickets.companyId} = ${companyId} and ${tickets.status} not in ('resolved', 'closed'))`,
      })
      .from(deals)
      .where(and(eq(deals.companyId, companyId), visibleWhere("deal", scope))),
    // What the customer paid, what it paid, and what is left as their credit (I10). Absent
    // without the sales module, or before the migration: the card is then not drawn.
    // ⚠️ A load that failed is said to have failed; a plan without sales has no card (I14).
    loadOutcome("company money", () => getCustomerMoney(companyId)),
    getTranslations("companies"),
    getTranslations("entityDetail"),
    getTranslations("invoicing"),
    getTranslations("common"),
    getTranslations("record"),
    getTranslations("pipeline.detail"),
    getTranslations("pipeline"),
    getTranslations("companies.detail"),
    getFormatter(),
    getTranslations("finance"),
  ]);
  // Rejections are read where each is awaited; until then they must not surface as unhandled.
  for (const pending of [aiP, restP]) pending.catch(() => undefined);

  const company = await companyP;
  if (!company) return notFound();

  const [
    timelineSummary,
    tasksList,
    allUsers,
    customFieldDefs,
    customFieldVals,
    record,
    // The edit dialog opened from here used to be handed none of its lookups, so
    // opening a company from its own page offered empty category and type
    // selects — and saving from that dialog wrote the blanks back.
    categories,
    companyTypeOptions,
    priceLists,
    people,
    [figures],
    moneyOutcome,
    t,
    tD,
    tI,
    tc,
    tR,
    tX,
    tP,
    tS,
    format,
    tFinance,
  ] = await restP;
  const ai = await aiP;

  // ── Server actions scoped to this company ──
  const pagePath = `/dashboard/companies/${companyId}`;

  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, companyId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/companies/${companyId}`);
    }
  }

  // ── Derived ──
  const today = dayOf(new Date());
  const ownerName = allUsers.find((u) => u.id === company.ownerId)?.name ?? null;
  // Named, not just present: "Rivenditori" is what the reader can check against
  // the quote they are about to send; an id is not.
  const priceListName = company.priceListId
    ? (priceLists.find((l) => l.id === company.priceListId)?.name ?? null)
    : null;
  const categoryName = company.companyCategoryId
    ? (categories.find((c) => c.id === company.companyCategoryId)?.name ?? null)
    : null;
  const activityTypeName = company.companyTypeId
    ? (companyTypeOptions.find((c) => c.id === company.companyTypeId)?.name ?? null)
    : null;
  const initials =
    company.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || null;
  const place = [company.city, company.country].filter(Boolean).join(", ");
  const websiteHref = company.website ? externalUrl(company.website) : null;
  const websiteLabel = company.website?.replace(/^https?:\/\//i, "").replace(/\/$/, "") ?? null;
  const hasAddress = !!(company.street || company.city || company.state || company.zipCode || company.country);
  // The province travels in `state`, the field the address form already has.
  const invoiceGaps = customerGaps({ ...company, province: company.state });

  const typeLabel = (type: string) => (t.has(`types.${type}` as never) ? t(`types.${type}` as never) : type);
  const statusLabel = (status: string) =>
    t.has(`statuses.${status}` as never) ? t(`statuses.${status}` as never) : status;

  const peopleTotal = people[0]?.total ?? 0;
  const openValue = Number(figures?.openValue ?? 0);
  const wonValue = Number(figures?.wonValue ?? 0);
  const openCount = figures?.openCount ?? 0;
  const wonCount = figures?.wonCount ?? 0;
  const openTickets = figures?.openTickets ?? 0;

  // The last contact that has happened, with this company or any of its people or deals.
  const lastActivity = timelineSummary.lastContactAt;
  const daysSinceActivity = lastActivity ? Math.max(0, Math.round((today - dayOf(lastActivity)) / DAY)) : null;

  // Open tasks first, the most urgent on top; what is done folds away underneath.
  const byDue = (a: (typeof tasksList)[number], b: (typeof tasksList)[number]) =>
    (a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY) -
    (b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY);
  const openTasks = tasksList.filter((tk) => tk.status !== "done").sort(byDue);
  const doneTasks = tasksList.filter((tk) => tk.status === "done");

  const renderTask = (task: (typeof tasksList)[number]) => {
    const done = task.status === "done";
    // An all-day task is due for the whole day, so it turns overdue at midnight
    // after it, not at the midnight it is stored as.
    const overdue =
      !done &&
      task.dueDate != null &&
      (task.allDay ? dayOf(new Date(task.dueDate)) < today : new Date(task.dueDate).getTime() < Date.now());
    return (
      <li key={task.id} className="flex items-start gap-2 py-2 text-sm">
        <TaskDoneButton task={task} canWrite={canWrite} revalidate={`/dashboard/companies/${companyId}`} />
        <div className="min-w-0 flex-1 pt-1.5">
          <p className={cn("break-words", done && "text-muted-foreground line-through")}>{task.title}</p>
          {task.description && !done && (
            <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{task.description}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
            {task.dueDate && (
              <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
                <ClockIcon className="size-3" aria-hidden />
                <FormattedDate date={task.dueDate} includeTime={!task.allDay} />
                {overdue && <span>· {tR("overdue")}</span>}
              </span>
            )}
            {task.startDate && !done && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="size-3" aria-hidden />
                {tD("startLabel")} <FormattedDate date={task.startDate} includeTime={!task.allDay} />
              </span>
            )}
            {!done && PRIORITY_KEY[task.priority] && task.priority !== "normal" && (
              <span className={PRIORITY_STYLES[task.priority]}>{tD(PRIORITY_KEY[task.priority] as never)}</span>
            )}
            <span className="truncate">
              {tD("toLabel")} {task.assigneeName || tD("myself")}
            </span>
            {done && task.completedAt ? (
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                {tD("completedLabel")} <FormattedDate date={task.completedAt} includeTime={false} />
              </span>
            ) : (
              <span>
                {tD("createdLabel")} <FormattedDate date={task.createdAt} includeTime={false} />
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
                await deleteTask(task.id, `/dashboard/companies/${companyId}`);
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

  const renderPerson = (person: (typeof people)[number]) => {
    const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
    const number = person.mobile || person.phone;
    const personInitials = `${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase();
    return (
      <li key={person.id} className="flex items-center gap-3 py-2">
        <Link href={`/dashboard/contacts/${person.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex size-9 shrink-0 select-none items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground text-xs"
            aria-hidden
          >
            {personInitials || <UserRoundIcon className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-sm hover:underline">{name}</span>
            {(person.jobTitle || person.email) && (
              <span className="block truncate text-muted-foreground text-xs">{person.jobTitle || person.email}</span>
            )}
          </span>
        </Link>
        {/* Reaching the person is the reason for the row, so the two ways to do it
            are on it — at a thumb's size on a phone, not behind the contact page. */}
        <div className="flex shrink-0 items-center gap-1">
          {number && (
            <Button asChild size="icon" variant="ghost" className="size-9 max-md:size-11">
              <a href={`tel:${number}`} aria-label={tS("callPerson", { name })} title={number}>
                <PhoneIcon className="size-4" aria-hidden />
              </a>
            </Button>
          )}
          {person.email && (
            <EmailAddressButton
              email={person.email}
              entity={{ ...person, companyName: company.name }}
              entityType="contact"
              canSend={canWrite}
              label={tS("emailPerson", { name })}
              title={person.email}
              className={buttonVariants({ size: "icon", variant: "ghost", className: "size-9 max-md:size-11" })}
            >
              <MailIcon className="size-4" aria-hidden />
            </EmailAddressButton>
          )}
        </div>
      </li>
    );
  };

  // ── Sections ──
  const nextSteps = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tD("companyTasksTitle")}</CardTitle>
        <span className="text-muted-foreground text-xs">{tP("openTasksCount", { count: openTasks.length })}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          <RecordComposer label={tD("createTask")} icon={<PlusIcon aria-hidden />}>
            <QuickTaskForm entityType="company" entityId={companyId} userId={userId ?? ""} />
          </RecordComposer>
        )}

        {openTasks.length === 0 ? (
          <EmptyHint>{tX("noOpenTasks")}</EmptyHint>
        ) : (
          <ul className="divide-y">{openTasks.map(renderTask)}</ul>
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

  const peopleCard = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tR("tabs.people")}</CardTitle>
        {peopleTotal > 0 && <span className="text-muted-foreground text-xs tabular-nums">{peopleTotal}</span>}
      </CardHeader>
      <CardContent className="space-y-2">
        {people.length === 0 ? (
          <EmptyHint>{tS("noPeople")}</EmptyHint>
        ) : (
          <>
            <ul className="divide-y">{people.slice(0, PEOPLE_VISIBLE).map(renderPerson)}</ul>
            {people.length > PEOPLE_VISIBLE && (
              <details className="group/people rounded-md border">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <span>
                    <span className="group-open/people:hidden">{tR("showMore")}</span>
                    <span className="hidden group-open/people:inline">{tR("showLess")}</span>
                    <span className="ml-1.5 tabular-nums">({people.length - PEOPLE_VISIBLE})</span>
                  </span>
                  <ChevronDownIcon className="size-4 transition-transform group-open/people:rotate-180" aria-hidden />
                </summary>
                <ul className="divide-y border-t px-3">{people.slice(PEOPLE_VISIBLE).map(renderPerson)}</ul>
              </details>
            )}
            {peopleTotal > people.length && (
              <p className="text-muted-foreground text-xs">
                {tS("peopleShown", { shown: people.length, total: peopleTotal })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  const timeline = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tD("timelineTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          /* On a phone the note takes the first line on its own and the type and
             the button share the second — the deal page's arrangement. */
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
                {tD("logActivity")}
              </Button>
            </form>
          </RecordComposer>
        )}

        <RecordTimeline scope={{ type: "company", id: companyId }} revalidatePathStr={pagePath} canWrite={canWrite} />
      </CardContent>
    </Card>
  );

  const sourceLabel = await sourceLabelP;
  const details = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BuildingIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("companyDetails")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={tD("fieldPhone")}>
            {company.mainPhone && (
              <a href={`tel:${company.mainPhone}`} className="text-primary hover:underline">
                {company.mainPhone}
              </a>
            )}
          </Field>
          <Field label={tD("fieldEmail")}>
            {company.mainEmail && (
              <EmailAddressButton
                email={company.mainEmail}
                entity={company}
                entityType="company"
                canSend={canWrite}
                className="break-all text-primary hover:underline"
              />
            )}
          </Field>
          <Field label={tD("fieldWebsite")}>
            {websiteHref && (
              <a
                href={websiteHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-primary hover:underline"
              >
                {websiteLabel}
              </a>
            )}
          </Field>
          <Field label={tD("sectionAddress")}>
            {hasAddress && (
              <address className="not-italic">
                {company.street && <span className="block">{company.street}</span>}
                {(company.city || company.state || company.zipCode) && (
                  <span className="block">
                    {[company.city, company.state, company.zipCode].filter(Boolean).join(", ")}
                  </span>
                )}
                {company.country && <span className="block">{company.country}</span>}
              </address>
            )}
          </Field>
          <Field label={tD("fieldType")}>{company.type && typeLabel(company.type)}</Field>
          <Field label={tD("fieldIndustry")}>{company.industry}</Field>
          <Field label={tD("fieldOwner")} always>
            {ownerName ?? tR("unassigned")}
          </Field>
          <Field label={t("fields.priceList")}>
            {priceListName && (
              <Badge variant="outline" className="gap-1.5">
                <ReceiptIcon className="size-3" aria-hidden />
                {priceListName}
              </Badge>
            )}
          </Field>
          <Field label={tD("fieldEmployees")}>
            {company.employeeCount != null && format.number(company.employeeCount)}
          </Field>
          <Field label={tD("fieldRevenue")}>
            {company.annualRevenue &&
              format.number(Number(company.annualRevenue), {
                style: "currency",
                currency: "EUR",
                maximumFractionDigits: 0,
              })}
          </Field>
        </FieldList>

        {/* What is looked up once a year: folded, and each row still hidden when empty. */}
        <details className="group/more">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1 text-muted-foreground text-sm hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">{tR("showMore")}</span>
            <span className="hidden group-open/more:inline">{tR("showLess")}</span>
            <ChevronDownIcon className="size-4 transition-transform group-open/more:rotate-180" aria-hidden />
          </summary>
          <FieldList className="pt-2">
            <Field label={tD("fieldStatus")} always>
              {statusLabel(company.status)}
            </Field>
            <Field label={t("form.category")}>{categoryName}</Field>
            <Field label={t("form.companyType")}>{activityTypeName}</Field>
            <Field label={tD("fieldSource")}>{sourceLabel(company.source)}</Field>
            <Field label={tD("fieldScore")}>{company.leadScore != null && String(company.leadScore)}</Field>
            <Field label={tD("fieldLinkedIn")}>
              {company.linkedinUrl && (
                <a
                  href={externalUrl(company.linkedinUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-primary hover:underline"
                >
                  {company.linkedinUrl.replace(/^https?:\/\/(www\.)?/i, "")}
                </a>
              )}
            </Field>
            <Field label={tR("created")}>
              <FormattedDate date={company.createdAt} />
            </Field>
            <Field label={tR("updated")}>
              <FormattedDate date={company.updatedAt} />
            </Field>
          </FieldList>
        </details>

        {company.tags && company.tags.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            <p className="font-medium text-muted-foreground text-xs">{tD("fieldTags")}</p>
            <div className="flex flex-wrap gap-1.5">
              {company.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {company.description && (
          <div className="border-t pt-3">
            <p className="mb-1 font-medium text-muted-foreground text-xs">{tD("fieldDescription")}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{company.description}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const billing = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptIcon className="size-4 text-muted-foreground" aria-hidden />
          {tI("billingTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={tD("fieldVatNumber")}>
            {company.vatNumber && <span className="font-mono">{company.vatNumber}</span>}
          </Field>
          <Field label={tI("fields.fiscalCode")}>
            {company.fiscalCode && <span className="font-mono">{company.fiscalCode}</span>}
          </Field>
          <Field label={tD("fieldSdiCode")}>
            {company.sdiCode && <span className="font-mono">{company.sdiCode}</span>}
          </Field>
          <Field label={tI("fields.pec")}>{company.pec && <span className="break-all">{company.pec}</span>}</Field>
        </FieldList>
        {/* What an invoice to this customer still needs, before anyone tries to issue one. */}
        {invoiceGaps.length === 0 ? (
          <p className="text-emerald-700 text-xs dark:text-emerald-400">{tI("customerReady")}</p>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/30">
            <p className="mb-1 font-medium">{tI("customerNotReady")}</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {invoiceGaps.map((g) => (
                <li key={`${g.field}-${g.problem}`}>
                  {tI(`fields.${g.field}` as "fields.vatNumber")} — {tI(`problems.${g.problem}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <RecordPage>
      <RecordVisit type="company" id={companyId} label={company.name} sub={company.city ?? null} />
      <RecordBackLink href="/dashboard/companies">{t("title")}</RecordBackLink>

      {/* ── Hero: who they are, where, and the ways to reach them ── */}
      <RecordHero
        avatar={<RecordAvatar className="rounded-xl">{initials ?? <BuildingIcon className="size-6" />}</RecordAvatar>}
        badges={
          company.type || company.status !== "active" || company.leadScore != null ? (
            <>
              {company.type && (
                <StatusBadge tone={TYPE_TONE[company.type] ?? "neutral"}>{typeLabel(company.type)}</StatusBadge>
              )}
              {/* Active is what every company is until it is not: only the
                  exception earns a badge. The status is always in the details. */}
              {company.status !== "active" && <StatusBadge tone="warning">{statusLabel(company.status)}</StatusBadge>}
              {company.leadScore != null && (
                <StatusBadge
                  tone={company.leadScore >= 70 ? "success" : company.leadScore >= 40 ? "warning" : "neutral"}
                >
                  {tS("score", { score: company.leadScore })}
                </StatusBadge>
              )}
            </>
          ) : undefined
        }
        title={company.name}
        meta={
          <>
            {company.industry && <MetaItem icon={<BuildingIcon aria-hidden />}>{company.industry}</MetaItem>}
            {place && <MetaItem icon={<MapPinIcon aria-hidden />}>{place}</MetaItem>}
            {websiteHref && (
              // External, so a plain anchor in a new tab rather than `MetaItem`'s
              // client-side Link, which would try to route to it inside the app.
              <a
                href={websiteHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1.5 hover:text-foreground hover:underline [&_svg]:size-3.5 [&_svg]:shrink-0"
              >
                <GlobeIcon aria-hidden />
                <span className="truncate">{websiteLabel}</span>
              </a>
            )}
            <MetaItem icon={<UserRoundIcon aria-hidden />}>
              {ownerName ? tR("assignedTo", { name: ownerName }) : tR("unassigned")}
            </MetaItem>
          </>
        }
        actions={
          <>
            {company.mainPhone && (
              <Button asChild size="sm" variant="outline">
                <a href={`tel:${company.mainPhone}`}>
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {tR("call")}
                </a>
              </Button>
            )}
            {company.mainEmail ? (
              <EmailAddressButton
                email={company.mainEmail}
                entity={company}
                entityType="company"
                canSend={canWrite}
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                <MailIcon className="size-3.5" aria-hidden />
                {tR("email")}
              </EmailAddressButton>
            ) : (
              websiteHref && (
                <Button asChild size="sm" variant="outline">
                  <a href={websiteHref} target="_blank" rel="noopener noreferrer">
                    <GlobeIcon className="size-3.5" aria-hidden />
                    {tD("fieldWebsite")}
                  </a>
                </Button>
              )
            )}
            {canWrite && (
              <CompanyModal
                company={company}
                categories={categories}
                companyTypes={companyTypeOptions}
                priceLists={priceLists}
              >
                <Button variant="outline" size="sm">
                  <PencilIcon className="size-3.5" aria-hidden />
                  {tR("edit")}
                </Button>
              </CompanyModal>
            )}
          </>
        }
      >
        {/* What the account is worth, whether anything is wrong, and whether
            anybody has been in touch. */}
        <MetricStrip>
          <Metric label={tS("metricPipeline")} hint={tS("openDeals", { count: openCount })}>
            <DealAmount value={openValue} />
          </Metric>
          <Metric
            label={tS("metricWon")}
            tone={wonValue > 0 ? "success" : undefined}
            hint={tS("wonDeals", { count: wonCount })}
          >
            <DealAmount value={wonValue} />
          </Metric>
          {/* A plan without the support module has no tickets to count, and a
              zero would read as "no problems" rather than "not tracked here". */}
          {record.modules.support && (
            <Metric label={tS("metricTickets")} tone={openTickets > 0 ? "danger" : undefined}>
              {openTickets}
            </Metric>
          )}
          <Metric
            label={tS("metricLastActivity")}
            hint={
              daysSinceActivity == null
                ? undefined
                : daysSinceActivity === 0
                  ? tR("today")
                  : tR("daysAgo", { days: daysSinceActivity })
            }
          >
            {lastActivity ? format.dateTime(lastActivity, { day: "numeric", month: "short", year: "numeric" }) : "—"}
          </Metric>
        </MetricStrip>
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
          { id: "people", label: tR("tabs.people"), icon: <UsersIcon aria-hidden />, count: peopleTotal },
          {
            id: "sales",
            label: tR("tabs.sales"),
            icon: <FileTextIcon aria-hidden />,
            count: record.deals.length + record.quotes.length + record.orders.length + record.tickets.length,
          },
          { id: "details", label: tR("tabs.details"), icon: <InfoIcon aria-hidden /> },
        ]}
        sections={[
          { tab: "next", column: "main", node: nextSteps },
          { tab: "people", column: "main", node: peopleCard },
          { tab: "activity", column: "main", node: timeline },
          // The commercial record first in the side column: what has been sold
          // outranks the codes it was invoiced under.
          {
            tab: "sales",
            column: "side",
            node: <CustomerRecordPanel record={record} companyId={companyId} canWrite={canWrite} />,
          },
          ...(ai.summary
            ? [
                {
                  tab: "activity",
                  column: "side" as const,
                  node: <AiSummaryCard subject={{ type: "company", id: companyId }} entry={ai.summary} />,
                },
              ]
            : []),
          { tab: "details", column: "side", node: details },
          { tab: "details", column: "side", node: billing },
          {
            tab: "details",
            column: "side",
            node: (
              <CustomFieldsPanel
                entityType="company"
                entityId={companyId}
                definitions={customFieldDefs}
                values={customFieldVals}
              />
            ),
          },
          ...(loadedValue(moneyOutcome)
            ? [
                {
                  tab: "sales",
                  column: "side" as const,
                  node: (
                    <CustomerMoneyCard
                      companyId={companyId}
                      data={loadedValue(moneyOutcome) as NonNullable<Awaited<ReturnType<typeof getCustomerMoney>>>}
                      canWrite={can(tenantRole, "invoice:write")}
                    />
                  ),
                },
              ]
            : failed(moneyOutcome)
              ? [
                  {
                    tab: "sales",
                    column: "side" as const,
                    node: <CashError text={tFinance("cash.loadError")} />,
                  },
                ]
              : []),
          { tab: "sales", column: "side", node: <DocumentPanel entityType="company" entityId={companyId} /> },
        ]}
      />
    </RecordPage>
  );
}

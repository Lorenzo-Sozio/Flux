import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BuildingIcon,
  CalendarX2Icon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  HourglassIcon,
  InfoIcon,
  ListChecksIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
  UserIcon,
  UserRoundIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { createActivity, getActivitiesByDeal } from "@/actions/activities";
import { getCompaniesForSelect, getContactsForSelect } from "@/actions/crm";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getDealComments } from "@/actions/deal-comments";
import { getComposerTemplates } from "@/actions/email-templates";
import { getOrdersByDeal } from "@/actions/orders";
import { getDealById, getLossReasons, getPipelineStages } from "@/actions/pipeline";
import { getQuotesByDeal } from "@/actions/quotes";
import { createTask, deleteTask, getAllUsers, getTasksByDeal } from "@/actions/tasks";
import { auth } from "@/auth";
import { ActivityModal } from "@/components/crm/activity-modal";
import { AiSummaryCard } from "@/components/crm/ai/ai-summary-card";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { DealEditButton } from "@/components/crm/deal-edit-button";
import { DocumentPanel } from "@/components/crm/document-panel";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { FormattedDate } from "@/components/crm/formatted-date";
import {
  ColourDot,
  EmptyHint,
  Field,
  FieldList,
  MetaItem,
  Metric,
  MetricStrip,
  RecordBackLink,
  RecordHero,
  RecordPage,
  RelatedRow,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { aiEntries, aiViewer } from "@/lib/ai/access";
import { can } from "@/lib/permissions";
import { recordTimelineSummary } from "@/lib/record-timeline";
import { getDb } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";

import { CommentsThread } from "./_components/comments-thread";
import { DealAmount } from "./_components/deal-amount";
import { DealStagePath } from "./_components/deal-stage-path";
import { MinutesDialog } from "./_components/minutes-dialog";

const DAY = 86_400_000;

const STATUS_TONE: Record<string, Tone> = { open: "info", won: "success", lost: "danger" };

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

/**
 * One deal, laid out for the person who has to move it.
 *
 * ⚠️ The order on screen is the order of the questions a rep asks: what is it
 * worth and when does it close (the figures), where is it (the stage path, which
 * is also how it moves), what do I do next (the tasks), what has happened (the
 * timeline). Reference material — who, the notes, the custom fields, the quotes
 * and the files — sits in the side column, where it is found when wanted and does
 * not stand between the rep and the next step. The previous layout put all of
 * that first, in a third of the width, and the stage was one grey line in eight.
 */
export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  // ⚠️ The workspace role. `session.user.role` is Flux's own staff scale and
  // reads "user" for every customer, so the comment thread offered no workspace
  // admin the delete control — while `deleteDealComment` would have allowed it,
  // because the guard hands back the tenant role. See CLAUDE.md on the two scales.
  const tenantRole = session?.user?.tenantRole ?? null;
  // A viewer reads the deal; the controls that would only answer "forbidden" are
  // not drawn for them.
  const canWrite = can(tenantRole, "record:write");
  // ⚠️ Started now, awaited where used: the copilot's entry and the timeline's count used to wait
  // in turn before and after the page's reads.
  const aiP: ReturnType<typeof aiEntries<"summary" | "draft">> = canWrite
    ? aiEntries(["summary", "draft"] as const, aiViewer(session?.user))
    : Promise.resolve({});
  const db = await getDb();
  const timelineSummaryP = recordTimelineSummary(db, { type: "deal", id: dealId });
  // Rejections are read where each is awaited; until then they must not surface as unhandled.
  for (const pending of [aiP, timelineSummaryP]) pending.catch(() => undefined);

  const [
    row,
    stages,
    activitiesList,
    tasksList,
    allUsers,
    quotesList,
    ordersList,
    commentsList,
    customFieldDefs,
    customFieldVals,
    emailTemplates,
    t,
    tD,
    tX,
    tStatus,
    tR,
    format,
  ] = await Promise.all([
    getDealById(dealId),
    // The stages, not the whole board: `getPipelineData` loaded every deal in the
    // workspace to read the column names off it.
    getPipelineStages(),
    getActivitiesByDeal(dealId),
    getTasksByDeal(dealId),
    getAllUsers(),
    getQuotesByDeal(dealId),
    // Did this deal actually become an order. The link has been in the data since
    // the conversion was wired up and nothing on the page showed it.
    getOrdersByDeal(dealId),
    getDealComments(dealId),
    // Custom fields have always been definable for a deal — the entity type is in
    // the picker — and there was nowhere to fill them in (audit rilievo U-09).
    getCustomFieldDefinitions("deal"),
    getCustomFieldValues("deal", dealId),
    // The saved emails for the dialog, only for whoever may send one; outside the marketing
    // module there are none, and the dialog works without.
    canWrite ? getComposerTemplates().catch(() => []) : Promise.resolve([]),
    getTranslations("pipeline"),
    getTranslations("entityDetail"),
    getTranslations("pipeline.detail"),
    getTranslations("entities.statuses"),
    getTranslations("record"),
    getFormatter(),
  ]);
  const ai = await aiP;
  const statusLabel = (s: string) => (tStatus.has(s as never) ? tStatus(s as never) : s);

  if (!row) return notFound();

  const {
    deal,
    stageName,
    stageColor,
    companyName,
    contactFirstName,
    contactLastName,
    contactEmail,
    contactPhone,
    contactMobile,
    ownerName,
    signals,
  } = row;

  // Why it was lost, by name — only fetched for the deals it applies to.
  const lossReason =
    deal.status === "lost" && deal.lossReasonId
      ? ((await getLossReasons(true)).find((r) => r.id === deal.lossReasonId)?.name ?? null)
      : null;
  const lostAtStage = deal.lostAtStageId ? stages.find((s) => s.id === deal.lostAtStageId)?.name : null;

  // ── Server actions scoped to this deal ──
  async function handleAddActivity(formData: FormData) {
    "use server";
    const content = formData.get("content") as string;
    const type = formData.get("type") as string;
    if (content) {
      await createActivity({ type: type || "note", content, dealId, ownerId: userId, date: new Date() });
      revalidatePath(`/dashboard/pipeline/${dealId}`);
    }
  }

  async function handleAddTask(formData: FormData) {
    "use server";
    const title = formData.get("title") as string;
    const dueDate = formData.get("dueDate") as string;
    const priority = formData.get("priority") as string;
    if (title) {
      await createTask({
        title,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        priority: priority || "normal",
        ownerId: userId,
        dealId,
      });
      revalidatePath(`/dashboard/pipeline/${dealId}`);
    }
  }

  // ── Derived ──
  const pagePath = `/dashboard/pipeline/${dealId}`;
  const today = dayOf(new Date());
  const isOpen = deal.status === "open";
  const amount = deal.amount != null ? Number(deal.amount) : null;
  const weighted = amount != null && deal.probability != null ? (amount * deal.probability) / 100 : null;
  const contactName = [contactFirstName, contactLastName].filter(Boolean).join(" ");
  const callNumber = contactMobile || contactPhone;

  // The close date says how far away it is, because "14 Oct" asks the reader to
  // work out whether that is next week or last week — and last week is the case
  // that needs acting on.
  const closeDate = deal.expectedCloseDate ? new Date(deal.expectedCloseDate) : null;
  const daysToClose = closeDate ? Math.round((dayOf(closeDate) - today) / DAY) : null;
  const closeOverdue = isOpen && daysToClose != null && daysToClose < 0;

  // Open tasks first, the most urgent on top; what is done folds away underneath.
  const byDue = (a: (typeof tasksList)[number], b: (typeof tasksList)[number]) =>
    (a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY) -
    (b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY);
  const openTasks = tasksList.filter((tk) => tk.status !== "done").sort(byDue);
  const doneTasks = tasksList.filter((tk) => tk.status === "done");

  const renderTask = (task: (typeof tasksList)[number]) => {
    const done = task.status === "done";
    const overdue = !done && task.dueDate != null && dayOf(new Date(task.dueDate)) < today;
    return (
      <li key={task.id} className="group flex items-center gap-2 py-1.5 text-sm">
        <TaskDoneButton task={task} canWrite={canWrite} revalidate={`/dashboard/pipeline/${dealId}`} />
        <div className="min-w-0 flex-1">
          <p className={cn("break-words", done && "text-muted-foreground line-through")}>{task.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
            {task.dueDate && (
              <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
                <ClockIcon className="size-3" aria-hidden />
                <FormattedDate date={task.dueDate} />
                {overdue && <span>· {tX("overdue")}</span>}
              </span>
            )}
            {!done && PRIORITY_KEY[task.priority] && task.priority !== "normal" && (
              <span className={PRIORITY_STYLES[task.priority]}>{tD(PRIORITY_KEY[task.priority] as never)}</span>
            )}
            {task.ownerName && <span className="truncate">{task.ownerName}</span>}
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center">
            <TaskModal task={task} users={allUsers} revalidatePathStr={pagePath} />
            <form
              action={async () => {
                "use server";
                await deleteTask(task.id, pagePath);
              }}
            >
              <button
                type="submit"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive max-md:size-9"
                title={t("deleteTask")}
                aria-label={t("deleteTask")}
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
        <span className="text-muted-foreground text-xs">{t("openTasksCount", { count: openTasks.length })}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && (
          /* Two columns on a phone — title across both, then priority and date,
             then the button across both — because four controls in one row do
             not fit 280px and a date input will not shrink below its picker. */
          <RecordComposer label={tD("createTask")} icon={<PlusIcon aria-hidden />}>
            <form action={handleAddTask} className="grid grid-cols-2 gap-2 sm:flex">
              <input
                name="title"
                required
                aria-label={t("newTaskPlaceholder")}
                placeholder={t("newTaskPlaceholder")}
                className="col-span-2 h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:h-11 md:text-sm"
              />
              <select
                name="priority"
                aria-label={tD("priorityLabel")}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm max-sm:h-11"
              >
                <option value="normal">{tD("priorityNormal")}</option>
                <option value="high">{tD("priorityHigh")}</option>
                <option value="low">{tD("priorityLow")}</option>
              </select>
              <input
                name="dueDate"
                type="date"
                aria-label={tD("dueDateLabel")}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-base max-sm:h-11 md:text-sm"
              />
              <Button type="submit" size="sm" className="col-span-2 max-sm:h-11">
                {t("addBtn")}
              </Button>
            </form>
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

  // Activity and comments: one card, two tabs — the history of the deal and the
  // team's conversation about it are read at different moments, and stacked they
  // made the page twice as long as either needs.
  // The timeline also holds the deal's field changes and quote events: its count comes
  // from the same place, so the badge and the list agree.
  const timelineSummary = await timelineSummaryP;

  const history = (
    <Card>
      <Tabs defaultValue="activity" className="gap-4">
        <CardHeader>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="activity" className="gap-1.5">
              <ClockIcon aria-hidden />
              {tX("tabActivity")}
              <span className="text-muted-foreground text-xs tabular-nums">{timelineSummary.count}</span>
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-1.5">
              <MessageSquareIcon aria-hidden />
              {tX("tabComments")}
              <span className="text-muted-foreground text-xs tabular-nums">{commentsList.length}</span>
            </TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="activity" className="space-y-3">
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
                    aria-label={t("logActivityPlaceholder")}
                    placeholder={t("logActivityPlaceholder")}
                    className="h-9 min-h-[36px] flex-1 resize-none py-1.5 max-sm:order-first max-sm:h-11 max-sm:min-h-11 max-sm:basis-full md:text-sm"
                  />
                  <Button type="submit" size="sm" className="max-sm:h-11">
                    {t("logBtn")}
                  </Button>
                </form>
              </RecordComposer>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 border-b pb-3">
              {/* Minutes for a meeting on this deal, assembled from what was
                  logged (audit rilievo S-06). Renders nothing when no meeting or
                  call has been recorded. */}
              <MinutesDialog
                dealName={deal.name}
                activities={activitiesList.map((a) => ({
                  id: a.id,
                  type: a.type,
                  content: a.content,
                  date: a.date,
                  durationMinutes: a.durationMinutes,
                  participants: a.participants,
                  ownerName: a.ownerName,
                }))}
                tasks={tasksList.map((tk) => ({
                  id: tk.id,
                  title: tk.title,
                  ownerName: tk.ownerName,
                  dueDate: tk.dueDate,
                  createdAt: tk.createdAt,
                  status: tk.status,
                }))}
              />
              {canWrite && (
                <ActivityModal
                  mode="create"
                  entityType="deal"
                  entityId={dealId}
                  ownerId={userId}
                  revalidatePathStr={pagePath}
                />
              )}
            </div>

            <RecordTimeline scope={{ type: "deal", id: dealId }} revalidatePathStr={pagePath} canWrite={canWrite} />
          </TabsContent>
          <TabsContent value="comments">
            <CommentsThread
              dealId={dealId}
              initialComments={commentsList}
              currentUserId={userId ?? ""}
              currentUserRole={tenantRole ?? "viewer"}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );

  const details = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tX("detailsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={tX("fieldStage")} always>
            {stageName && (
              <span className="flex min-w-0 items-center gap-1.5">
                <ColourDot colour={stageColor} />
                <span className="truncate">{stageName}</span>
              </span>
            )}
          </Field>
          <Field label={tX("fieldOwner")} always>
            {ownerName ?? tX("unassigned")}
          </Field>
          <Field label={tX("fieldCompany")} always>
            {companyName &&
              (deal.companyId ? (
                <Link href={`/dashboard/companies/${deal.companyId}`} className="text-primary hover:underline">
                  {companyName}
                </Link>
              ) : (
                companyName
              ))}
          </Field>
          <Field label={tX("fieldContact")} always>
            {contactName && (
              <div className="min-w-0 space-y-0.5">
                {deal.contactId ? (
                  <Link href={`/dashboard/contacts/${deal.contactId}`} className="text-primary hover:underline">
                    {contactName}
                  </Link>
                ) : (
                  <span>{contactName}</span>
                )}
                {contactEmail && (
                  <EmailAddressButton
                    email={contactEmail}
                    entity={{
                      id: deal.contactId ?? "",
                      firstName: contactFirstName,
                      lastName: contactLastName,
                      phone: contactPhone ?? contactMobile,
                      companyName,
                    }}
                    entityType="contact"
                    dealId={dealId}
                    templates={emailTemplates}
                    ownerId={userId}
                    ai={ai.draft ?? null}
                    canSend={canWrite}
                    className="block truncate text-muted-foreground text-xs hover:text-foreground"
                  />
                )}
                {callNumber && (
                  <a href={`tel:${callNumber}`} className="block text-muted-foreground text-xs hover:text-foreground">
                    {callNumber}
                  </a>
                )}
              </div>
            )}
          </Field>
          <Field label={tX("fieldCreated")}>
            <FormattedDate date={deal.createdAt} />
          </Field>
          <Field label={tX("fieldUpdated")}>
            <FormattedDate date={deal.updatedAt} />
          </Field>
          {deal.status === "lost" && (
            <>
              <Field label={tX("fieldLostAt")}>{lostAtStage}</Field>
              <Field label={tX("fieldLossReason")}>{lossReason}</Field>
              <Field label={tX("fieldCompetitor")}>{deal.lostCompetitor}</Field>
              <Field label={tX("fieldLossNote")}>{deal.lostReason}</Field>
            </>
          )}
        </FieldList>

        <div className="border-t pt-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs">{t("fieldNotes")}</p>
          {deal.notes ? (
            <p className="whitespace-pre-wrap break-words text-sm">{deal.notes}</p>
          ) : (
            <p className="text-muted-foreground text-sm">—</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Quotes and orders: one card, because an order is where a quote ends up.
  const sales = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{tX("salesTitle")}</CardTitle>
        {canWrite && (
          // ⚠️ The full quote form, not a second one (§7.4): the dialog that was here ignored
          // price lists, product tax rates and currency, offered retired products, and did not
          // work for a deal with no company. The form reads the deal, company and contact.
          <Button size="sm" asChild>
            <Link
              href={`/dashboard/sales/quotes/new?${new URLSearchParams({
                dealId,
                ...(deal.companyId ? { companyId: deal.companyId } : {}),
                ...(deal.contactId ? { contactId: deal.contactId } : {}),
              }).toString()}`}
            >
              {tX("addQuote")}
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <SubHeading icon={<FileTextIcon aria-hidden />}>{tX("quotesHeading")}</SubHeading>
          {quotesList.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noQuotesYet")}</p>
          ) : (
            <ul className="space-y-2">
              {quotesList.map((quote) => (
                <li key={quote.id}>
                  <RelatedRow
                    href={`/dashboard/sales/quotes/${quote.id}`}
                    title={quote.quoteNumber}
                    sub={format.dateTime(new Date(quote.issuedAt), { dateStyle: "medium" })}
                    aside={
                      <>
                        <span className="font-semibold tabular-nums">
                          {format.number(Number(quote.totalAmount), { style: "currency", currency: quote.currency })}
                        </span>
                        <Badge variant="outline" className="text-[11px]">
                          {statusLabel(quote.status)}
                        </Badge>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t pt-3">
          <SubHeading icon={<ShoppingCartIcon aria-hidden />}>{tX("ordersHeading")}</SubHeading>
          {ordersList.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noOrdersFromDeal")}</p>
          ) : (
            <ul className="space-y-2">
              {ordersList.map((order) => (
                <li key={order.id}>
                  <RelatedRow
                    href={`/dashboard/sales/orders/${order.id}`}
                    title={order.orderNumber}
                    sub={format.dateTime(new Date(order.orderDate), { dateStyle: "medium" })}
                    aside={
                      <Badge variant="outline" className="text-[11px]">
                        {statusLabel(order.status)}
                      </Badge>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );

  return (
    <RecordPage>
      <RecordVisit type="deal" id={dealId} label={deal.name} sub={companyName ?? null} />
      <RecordBackLink href="/dashboard/pipeline">{t("backToPipeline")}</RecordBackLink>

      {/* ── Hero: who, how much, when, where it stands ── */}
      <RecordHero
        badges={
          <>
            <StatusBadge tone={STATUS_TONE[deal.status] ?? "neutral"}>{statusLabel(deal.status)}</StatusBadge>
            {isOpen && stageName && (
              <StatusBadge>
                <ColourDot colour={stageColor} />
                {stageName}
              </StatusBadge>
            )}
            {/* Computed on this read, not stored (src/lib/deal-signals.ts). */}
            {isOpen && !signals.hasNextStep && (
              <StatusBadge tone="warning">
                <CalendarX2Icon aria-hidden />
                {t("signals.noNextStep")}
              </StatusBadge>
            )}
            {isOpen && signals.stalled && (
              <StatusBadge tone="warning">
                <HourglassIcon aria-hidden />
                {t("signals.idle", { days: signals.idleDays })}
              </StatusBadge>
            )}
          </>
        }
        title={deal.name}
        meta={
          <>
            {companyName && (
              <MetaItem
                icon={<BuildingIcon aria-hidden />}
                href={deal.companyId ? `/dashboard/companies/${deal.companyId}` : null}
              >
                {companyName}
              </MetaItem>
            )}
            {contactName && (
              <MetaItem
                icon={<UserIcon aria-hidden />}
                href={deal.contactId ? `/dashboard/contacts/${deal.contactId}` : null}
              >
                {contactName}
              </MetaItem>
            )}
            <MetaItem icon={<UserRoundIcon aria-hidden />}>
              {ownerName ? tX("assignedTo", { name: ownerName }) : tX("unassigned")}
            </MetaItem>
          </>
        }
        actions={
          <>
            {callNumber && (
              <Button asChild size="sm" variant="outline">
                <a href={`tel:${callNumber}`}>
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {tD("callAction")}
                </a>
              </Button>
            )}
            {/* Sent from Flux, it is logged on the deal and on its contact; a read-only member,
                who cannot send from Flux, keeps the mail client. */}
            {contactEmail && canWrite && deal.contactId ? (
              <SendEmailModal
                entity={{
                  id: deal.contactId,
                  firstName: contactFirstName,
                  lastName: contactLastName,
                  email: contactEmail,
                  phone: contactPhone ?? contactMobile,
                  companyName,
                }}
                entityType="contact"
                dealId={dealId}
                templates={emailTemplates}
                ownerId={userId}
                ai={ai.draft}
              />
            ) : contactEmail ? (
              <Button asChild size="sm" variant="outline">
                <a href={`mailto:${contactEmail}`}>
                  <MailIcon className="size-3.5" aria-hidden />
                  {tX("email")}
                </a>
              </Button>
            ) : null}
            {canWrite && <DealEditButton deal={deal} stages={stages} />}
          </>
        }
      >
        {/* The four numbers a forecast is made of. */}
        <MetricStrip>
          <Metric label={tX("metricValue")}>
            <DealAmount value={amount} />
          </Metric>
          <Metric
            label={tX("metricProbability")}
            hint={
              deal.probability != null && (
                <span className="mt-1 block h-1 w-full max-w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.max(0, deal.probability))}%` }}
                  />
                </span>
              )
            }
          >
            {deal.probability != null ? `${deal.probability}%` : "—"}
          </Metric>
          <Metric label={tX("metricWeighted")}>{isOpen ? <DealAmount value={weighted} /> : "—"}</Metric>
          {!isOpen && deal.closedAt ? (
            <Metric label={tX("metricClosed")}>
              {format.dateTime(new Date(deal.closedAt), { day: "numeric", month: "short", year: "numeric" })}
            </Metric>
          ) : (
            <Metric
              label={tX("metricClose")}
              tone={closeOverdue ? "danger" : undefined}
              hint={
                closeDate && isOpen && daysToClose != null
                  ? daysToClose === 0
                    ? tX("today")
                    : closeOverdue
                      ? tX("overdueBy", { days: -daysToClose })
                      : tX("inDays", { days: daysToClose })
                  : undefined
              }
            >
              {closeDate
                ? format.dateTime(closeDate, { day: "numeric", month: "short", year: "numeric" })
                : tX("notSet")}
            </Metric>
          )}
        </MetricStrip>

        <div className="border-t pt-4">
          <DealStagePath
            dealId={dealId}
            dealName={deal.name}
            status={deal.status}
            stageId={deal.stageId}
            lostAtStageId={deal.lostAtStageId}
            closedAt={deal.closedAt}
            stages={stages.map((s) => ({ id: s.id, name: s.name, color: s.color, isWon: s.isWon, isLost: s.isLost }))}
            canWrite={canWrite}
          />
        </div>
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          { id: "next", label: tR("tabs.nextSteps"), icon: <ListChecksIcon aria-hidden />, count: openTasks.length },
          {
            id: "activity",
            label: tR("tabs.activity"),
            icon: <ClockIcon aria-hidden />,
            count: timelineSummary.count + commentsList.length,
          },
          { id: "details", label: tR("tabs.details"), icon: <InfoIcon aria-hidden /> },
          {
            id: "sales",
            label: tR("tabs.sales"),
            icon: <FileTextIcon aria-hidden />,
            count: quotesList.length + ordersList.length,
          },
        ]}
        sections={[
          { tab: "next", column: "main", node: nextSteps },
          { tab: "activity", column: "main", node: history },
          ...(ai.summary
            ? [
                {
                  tab: "activity",
                  column: "side" as const,
                  node: <AiSummaryCard subject={{ type: "deal", id: dealId }} entry={ai.summary} />,
                },
              ]
            : []),
          { tab: "details", column: "side", node: details },
          {
            tab: "details",
            column: "side",
            node: (
              <CustomFieldsPanel
                entityType="deal"
                entityId={dealId}
                definitions={customFieldDefs}
                values={customFieldVals}
              />
            ),
          },
          { tab: "sales", column: "side", node: sales },
          { tab: "sales", column: "side", node: <DocumentPanel entityType="deal" entityId={dealId} /> },
        ]}
      />
    </RecordPage>
  );
}

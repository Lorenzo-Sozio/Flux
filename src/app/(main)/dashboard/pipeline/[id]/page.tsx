import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  CircleIcon,
  ClockIcon,
  KanbanIcon,
  Trash2Icon,
  TrendingUpIcon,
  UserIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { createActivity, getActivitiesByDeal } from "@/actions/activities";
import { getCompanies, getContacts } from "@/actions/crm";
import { getCustomFieldDefinitions, getCustomFieldValues } from "@/actions/custom-fields";
import { getDealComments } from "@/actions/deal-comments";
import { getOrdersByDeal } from "@/actions/orders";
import { getDealById, getPipelineData } from "@/actions/pipeline";
import { getQuotesByDeal } from "@/actions/quotes";
import { createTask, deleteTask, getAllUsers, getTasksByDeal, updateTaskStatus } from "@/actions/tasks";
import { auth } from "@/auth";
import { ActivityModal } from "@/components/crm/activity-modal";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CreateQuoteButton } from "@/components/crm/create-quote-button";
import { CustomFieldsPanel } from "@/components/crm/custom-fields-panel";
import { DealEditButton } from "@/components/crm/deal-edit-button";
import { DocumentPanel } from "@/components/crm/document-panel";
import { FormattedDate } from "@/components/crm/formatted-date";
import { RecordVisit } from "@/components/crm/record-visit";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getDb } from "@/lib/tenant-context";

import { CommentsThread } from "./_components/comments-thread";
import { DealAmount } from "./_components/deal-amount";
import { MinutesDialog } from "./_components/minutes-dialog";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  // ⚠️ The workspace role. `session.user.role` is Flux's own staff scale and
  // reads "user" for every customer, so the comment thread offered no workspace
  // admin the delete control — while `deleteDealComment` would have allowed it,
  // because the guard hands back the tenant role. See CLAUDE.md on the two scales.
  const tenantRole = session?.user?.tenantRole ?? null;
  const db = await getDb();

  const [
    row,
    { stages },
    activitiesList,
    tasksList,
    allUsers,
    quotesList,
    ordersList,
    productsList,
    companiesList,
    contactsList,
    commentsList,
    customFieldDefs,
    customFieldVals,
    t,
    tD,
  ] = await Promise.all([
    getDealById(dealId),
    getPipelineData(),
    getActivitiesByDeal(dealId),
    getTasksByDeal(dealId),
    getAllUsers(),
    getQuotesByDeal(dealId),
    // Did this deal actually become an order. The link has been in the data since
    // the conversion was wired up and nothing on the page showed it.
    getOrdersByDeal(dealId),
    db.query.products.findMany(),
    getCompanies(),
    getContacts(),
    getDealComments(dealId),
    // Custom fields have always been definable for a deal — the entity type is in
    // the picker — and there was nowhere to fill them in (audit rilievo U-09).
    getCustomFieldDefinitions("deal"),
    getCustomFieldValues("deal", dealId),
    getTranslations("pipeline"),
    getTranslations("entityDetail"),
  ]);

  if (!row) return notFound();

  const { deal, stageName, stageColor, companyName, contactFirstName, contactLastName, contactEmail, ownerName } = row;

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

  async function handleToggleTask(formData: FormData) {
    "use server";
    const taskId = formData.get("taskId") as string;
    const status = formData.get("status") as string;
    const newStatus = status === "done" ? "todo" : "done";
    await updateTaskStatus(taskId, newStatus, `/dashboard/pipeline/${dealId}`);
  }

  // ── Derived ──
  const revalidatePath_ = `/dashboard/pipeline/${dealId}`;
  const statusColors: Record<string, string> = {
    open: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    lost: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };

  const priorityColors: Record<string, string> = {
    high: "text-red-500",
    normal: "text-yellow-500",
    low: "text-slate-400",
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <RecordVisit type="deal" name={deal.name} href={`/dashboard/pipeline/${dealId}`} />

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="flex w-full flex-col gap-5 md:w-1/3">
        {/* Back + title */}
        <div>
          <Link
            href="/dashboard/pipeline"
            className="mb-3 flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            {t("backToPipeline")}
          </Link>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-xl leading-snug">{deal.name}</CardTitle>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge className={statusColors[deal.status] ?? ""} variant="outline">
                    {deal.status}
                  </Badge>
                  <DealEditButton deal={deal} stages={stages} companies={companiesList} contacts={contactsList} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {/* Stage */}
              <div className="flex items-center gap-2">
                <KanbanIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("fieldStage")}</span>
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stageColor ?? "#94a3b8" }} />
                  {stageName ?? "—"}
                </span>
              </div>

              {/* Amount */}
              <div className="flex items-center gap-2">
                <TrendingUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("fieldValue")}</span>
                <span className="font-semibold text-base">
                  <DealAmount amount={deal.amount} probability={deal.probability} />
                </span>
              </div>

              {/* Company */}
              {companyName && (
                <div className="flex items-center gap-2">
                  <BuildingIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("fieldCompany")}</span>
                  {deal.companyId ? (
                    <Link href={`/dashboard/companies/${deal.companyId}`} className="font-medium hover:underline">
                      {companyName}
                    </Link>
                  ) : (
                    <span className="font-medium">{companyName}</span>
                  )}
                </div>
              )}

              {/* Contact */}
              {(contactFirstName || contactLastName) && (
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("fieldContact")}</span>
                  {deal.contactId ? (
                    <Link href={`/dashboard/contacts/${deal.contactId}`} className="font-medium hover:underline">
                      {contactFirstName} {contactLastName}
                    </Link>
                  ) : (
                    <span className="font-medium">
                      {contactFirstName} {contactLastName}
                    </span>
                  )}
                </div>
              )}

              {/* Close date */}
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{t("fieldExpectedClose")}</span>
                <span className="font-medium">
                  {deal.expectedCloseDate
                    ? new Date(deal.expectedCloseDate).toLocaleDateString(undefined, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </span>
              </div>

              {/* Owner */}
              {ownerName && (
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">{t("fieldOwner")}</span>
                  <span className="font-medium">{ownerName}</span>
                </div>
              )}

              {/* Notes */}
              {deal.notes && (
                <div className="border-t pt-2">
                  <p className="mb-1 text-muted-foreground text-xs">{t("fieldNotes")}</p>
                  <p className="whitespace-pre-wrap text-sm">{deal.notes}</p>
                </div>
              )}

              <div className="border-t pt-2 text-muted-foreground text-xs">
                {t("createdOn")} <FormattedDate date={deal.createdAt} />
              </div>
            </CardContent>
          </Card>
        </div>

        <CustomFieldsPanel entityType="deal" entityId={dealId} definitions={customFieldDefs} values={customFieldVals} />

        {/* Documents */}
        <DocumentPanel entityType="deal" entityId={dealId} />

        {/* Quotes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{t("quotesProposals")}</CardTitle>
            <CreateQuoteButton
              dealId={dealId}
              companyId={deal.companyId || ""}
              contactId={deal.contactId || ""}
              products={productsList.map((p) => ({ id: p.id, name: p.name, price: p.price?.toString() || "0" }))}
            />
          </CardHeader>
          <CardContent>
            {quotesList.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">{t("noQuotesYet")}</p>
            ) : (
              <div className="space-y-2">
                {quotesList.map((quote) => (
                  <Link key={quote.id} href={`/dashboard/sales/quotes/${quote.id}`}>
                    <div className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent">
                      <div>
                        <p className="font-medium text-sm">{quote.quoteNumber}</p>
                        <p className="text-muted-foreground text-xs">{new Date(quote.issuedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{quote.status}</Badge>
                        <span className="font-semibold text-sm">
                          {quote.currency} {parseFloat(quote.totalAmount).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Orders */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("ordersFromDeal")}</CardTitle>
          </CardHeader>
          <CardContent>
            {ordersList.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">{t("noOrdersFromDeal")}</p>
            ) : (
              <div className="space-y-2">
                {ordersList.map((order) => (
                  <Link key={order.id} href={`/dashboard/sales/orders/${order.id}`}>
                    <div className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent">
                      <div>
                        <p className="font-medium text-sm">{order.orderNumber}</p>
                        <p className="text-muted-foreground text-xs">
                          {new Date(order.orderDate).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="outline">{order.status}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-5">
        {/* Activities */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{t("activityTimeline")}</CardTitle>
            <ActivityModal
              mode="create"
              entityType="deal"
              entityId={dealId}
              ownerId={userId}
              revalidatePathStr={revalidatePath_}
            />
          </CardHeader>
          <CardContent className="space-y-1">
            {/* Quick log form */}
            <form action={handleAddActivity} className="flex gap-2 border-b pb-4">
              <select name="type" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="note">{tD("activityTypes.note")}</option>
                <option value="call">{tD("activityTypes.call")}</option>
                <option value="meeting">{tD("activityTypes.meeting")}</option>
              </select>
              <Textarea
                name="content"
                placeholder={t("logActivityPlaceholder")}
                className="h-9 min-h-[36px] flex-1 resize-none py-1.5 text-sm"
              />
              <Button type="submit" size="sm" variant="outline">
                {t("logBtn")}
              </Button>
            </form>

            {/*
              Minutes for a meeting on this deal, assembled from what was logged
              (audit rilievo S-06). Renders nothing when no meeting or call has
              been recorded, so it does not offer a document it cannot produce.
            */}
            <div className="flex justify-end">
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
                tasks={tasksList.map((t) => ({
                  id: t.id,
                  title: t.title,
                  ownerName: t.ownerName,
                  dueDate: t.dueDate,
                  createdAt: t.createdAt,
                  status: t.status,
                }))}
              />
            </div>

            <ActivityTimeline
              activities={activitiesList}
              revalidatePathStr={revalidatePath_}
              noActivitiesLabel={t("noActivitiesYet")}
            />
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{tD("tasksNextStepsTitle")}</CardTitle>
            <span className="text-muted-foreground text-xs">
              {t("openTasksCount", { count: tasksList.filter((tk) => tk.status !== "done").length })}
            </span>
          </CardHeader>
          <CardContent className="space-y-1">
            {/* Quick add task */}
            <form action={handleAddTask} className="flex gap-2 border-b pb-4">
              <input
                name="title"
                placeholder={t("newTaskPlaceholder")}
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <select name="priority" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="normal">{tD("priorityNormal")}</option>
                <option value="high">{tD("priorityHigh")}</option>
                <option value="low">{tD("priorityLow")}</option>
              </select>
              <input
                name="dueDate"
                type="date"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              />
              <Button type="submit" size="sm" variant="outline">
                {t("addBtn")}
              </Button>
            </form>

            {tasksList.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-sm">{t("noTasksYet")}</p>
            ) : (
              <div className="space-y-2 pt-1">
                {tasksList.map((task) => (
                  <div key={task.id} className="group flex items-center gap-3 text-sm">
                    <form action={handleToggleTask}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="status" value={task.status} />
                      <button type="submit" className="shrink-0 text-muted-foreground hover:text-primary">
                        {task.status === "done" ? (
                          <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <CircleIcon className="h-4 w-4" />
                        )}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className={task.status === "done" ? "text-muted-foreground line-through" : ""}>{task.title}</p>
                      {task.dueDate && (
                        <p className="flex items-center gap-1 text-muted-foreground text-xs">
                          <ClockIcon className="h-3 w-3" />
                          <FormattedDate date={task.dueDate} />
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 text-xs ${priorityColors[task.priority] ?? ""}`}>{task.priority}</span>
                    <TaskModal task={task} users={allUsers} revalidatePathStr={revalidatePath_} />
                    <form
                      action={async () => {
                        "use server";
                        await deleteTask(task.id, revalidatePath_);
                      }}
                    >
                      <button
                        type="submit"
                        className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Comments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Comments</CardTitle>
          </CardHeader>
          <CardContent>
            <CommentsThread
              dealId={dealId}
              initialComments={commentsList}
              currentUserId={userId ?? ""}
              currentUserRole={tenantRole ?? "viewer"}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

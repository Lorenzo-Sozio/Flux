import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getDealById, updateDeal, getPipelineData } from "@/actions/pipeline";
import { getActivitiesByDeal, createActivity } from "@/actions/activities";
import { getTasksByDeal, createTask, updateTaskStatus, getAllUsers } from "@/actions/tasks";
import { getQuotesByDeal } from "@/actions/quotes";
import { getCompanies, getContacts } from "@/actions/crm";
import { revalidatePath } from "next/cache";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  KanbanIcon, BuildingIcon, UserIcon, CalendarIcon,
  TrendingUpIcon, CheckCircle2Icon, ClockIcon, CircleIcon,
  ChevronLeftIcon,
} from "lucide-react";
import { FormattedDate } from "@/components/crm/formatted-date";
import { ActivityModal } from "@/components/crm/activity-modal";
import { TaskModal } from "@/components/crm/task-modal";
import { DocumentPanel } from "@/components/crm/document-panel";
import { RecordVisit } from "@/components/crm/record-visit";
import { CreateQuoteButton } from "@/components/crm/create-quote-button";
import { DealEditButton } from "@/components/crm/deal-edit-button";
import { db } from "@/db";
import { products } from "@/db/schema";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const session = await auth();
  const userId = session?.user?.id;

  const [row, { stages }, activitiesList, tasksList, allUsers, quotesList, productsList, companiesList, contactsList] = await Promise.all([
    getDealById(dealId),
    getPipelineData(),
    getActivitiesByDeal(dealId),
    getTasksByDeal(dealId),
    getAllUsers(),
    getQuotesByDeal(dealId),
    db.query.products.findMany(),
    getCompanies(),
    getContacts(),
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
      await createTask({ title, dueDate: dueDate ? new Date(dueDate) : undefined, priority: priority || "normal", ownerId: userId, dealId });
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
    won:  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    lost: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };

  const activityIcons: Record<string, string> = { note: "📝", call: "📞", meeting: "👥", email: "📧" };
  const priorityColors: Record<string, string> = {
    high: "text-red-500", normal: "text-yellow-500", low: "text-slate-400",
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6">
      <RecordVisit type="deal" name={deal.name} href={`/dashboard/pipeline/${dealId}`} />

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="w-full md:w-1/3 flex flex-col gap-5">

        {/* Back + title */}
        <div>
          <Link href="/dashboard/pipeline" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ChevronLeftIcon className="h-4 w-4" />
            Back to Pipeline
          </Link>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-xl leading-snug">{deal.name}</CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={statusColors[deal.status] ?? ""} variant="outline">
                    {deal.status}
                  </Badge>
                  <DealEditButton
                    deal={deal}
                    stages={stages}
                    companies={companiesList}
                    contacts={contactsList}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {/* Stage */}
              <div className="flex items-center gap-2">
                <KanbanIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Stage:</span>
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: stageColor ?? "#94a3b8" }} />
                  {stageName ?? "—"}
                </span>
              </div>

              {/* Amount */}
              <div className="flex items-center gap-2">
                <TrendingUpIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Value:</span>
                <span className="font-semibold text-base">
                  {deal.amount
                    ? new Intl.NumberFormat("it-IT", { style: "currency", currency: deal.currency || "EUR" }).format(Number(deal.amount))
                    : "—"}
                  {deal.probability != null && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">({deal.probability}%)</span>
                  )}
                </span>
              </div>

              {/* Company */}
              {companyName && (
                <div className="flex items-center gap-2">
                  <BuildingIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Company:</span>
                  {deal.companyId
                    ? <Link href={`/dashboard/companies/${deal.companyId}`} className="font-medium hover:underline">{companyName}</Link>
                    : <span className="font-medium">{companyName}</span>}
                </div>
              )}

              {/* Contact */}
              {(contactFirstName || contactLastName) && (
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Contact:</span>
                  {deal.contactId
                    ? <Link href={`/dashboard/contacts/${deal.contactId}`} className="font-medium hover:underline">{contactFirstName} {contactLastName}</Link>
                    : <span className="font-medium">{contactFirstName} {contactLastName}</span>}
                </div>
              )}

              {/* Close date */}
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Expected close:</span>
                <span className="font-medium">
                  {deal.expectedCloseDate
                    ? new Date(deal.expectedCloseDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                    : "—"}
                </span>
              </div>

              {/* Owner */}
              {ownerName && (
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Owner:</span>
                  <span className="font-medium">{ownerName}</span>
                </div>
              )}

              {/* Notes */}
              {deal.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
                </div>
              )}

              <div className="pt-2 border-t text-xs text-muted-foreground">
                Created <FormattedDate date={deal.createdAt} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Documents */}
        <DocumentPanel entityType="deal" entityId={dealId} />

        {/* Quotes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Quotes & Proposals</CardTitle>
            <CreateQuoteButton
              dealId={dealId}
              companyId={deal.companyId || ""}
              contactId={deal.contactId || ""}
              products={productsList.map(p => ({ id: p.id, name: p.name, price: p.price?.toString() || "0" }))}
            />
          </CardHeader>
          <CardContent>
            {quotesList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No quotes yet. Create one to start proposal management.</p>
            ) : (
              <div className="space-y-2">
                {quotesList.map((quote) => (
                  <Link key={quote.id} href={`/dashboard/quotes/${quote.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-md border hover:bg-accent cursor-pointer transition-colors">
                      <div>
                        <p className="font-medium text-sm">{quote.quoteNumber}</p>
                        <p className="text-xs text-muted-foreground">{new Date(quote.issuedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{quote.status}</Badge>
                        <span className="font-semibold text-sm">{quote.currency} {parseFloat(quote.totalAmount).toFixed(2)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-5">

        {/* Activities */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Activity Timeline</CardTitle>
            <ActivityModal mode="create" entityType="deal" entityId={dealId} ownerId={userId} revalidatePathStr={revalidatePath_} />
          </CardHeader>
          <CardContent className="space-y-1">
            {/* Quick log form */}
            <form action={handleAddActivity} className="flex gap-2 pb-4 border-b">
              <select name="type" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
              </select>
              <Textarea name="content" placeholder="Log a note, call, meeting…" className="min-h-[36px] h-9 resize-none py-1.5 text-sm flex-1" />
              <Button type="submit" size="sm" variant="outline">Log</Button>
            </form>

            {activitiesList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No activities yet.</p>
            ) : (
              <div className="space-y-3 pt-1">
                {activitiesList.map((act) => (
                  <div key={act.id} className="flex gap-3 text-sm">
                    <span className="text-base mt-0.5 shrink-0">{activityIcons[act.type] ?? "📌"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="leading-snug">{act.content}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {act.ownerName && <span>{act.ownerName} · </span>}
                        <FormattedDate date={act.createdAt} />
                      </p>
                    </div>
                    <ActivityModal mode="edit" activity={act} revalidatePathStr={revalidatePath_} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Tasks</CardTitle>
            <span className="text-xs text-muted-foreground">{tasksList.filter((t) => t.status !== "done").length} open</span>
          </CardHeader>
          <CardContent className="space-y-1">
            {/* Quick add task */}
            <form action={handleAddTask} className="flex gap-2 pb-4 border-b">
              <input name="title" placeholder="New task…" className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm" />
              <select name="priority" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
              <input name="dueDate" type="date" className="h-9 rounded-md border border-input bg-background px-2 text-sm" />
              <Button type="submit" size="sm" variant="outline">Add</Button>
            </form>

            {tasksList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No tasks yet.</p>
            ) : (
              <div className="space-y-2 pt-1">
                {tasksList.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 text-sm group">
                    <form action={handleToggleTask}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="status" value={task.status} />
                      <button type="submit" className="shrink-0 text-muted-foreground hover:text-primary">
                        {task.status === "done"
                          ? <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
                          : <CircleIcon className="h-4 w-4" />}
                      </button>
                    </form>
                    <div className="flex-1 min-w-0">
                      <p className={task.status === "done" ? "line-through text-muted-foreground" : ""}>{task.title}</p>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <ClockIcon className="h-3 w-3" />
                          <FormattedDate date={task.dueDate} />
                        </p>
                      )}
                    </div>
                    <span className={`text-xs shrink-0 ${priorityColors[task.priority] ?? ""}`}>{task.priority}</span>
                    <TaskModal task={task} users={allUsers} revalidatePathStr={revalidatePath_} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

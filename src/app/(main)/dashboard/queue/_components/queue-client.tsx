"use client";

import { useEffect, useState, useTransition } from "react";

import Link from "next/link";

import { ArrowRight, CheckCircle2, Clock, ExternalLink, Mail, Phone, SkipForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { logContactAction } from "@/actions/activities";
import { snoozeNextActionAction } from "@/actions/next-actions";
import { updateTaskStatus } from "@/actions/tasks";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { TaskTypePicker } from "@/components/crm/task-type-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { NextAction } from "@/lib/next-actions";
import type { Reach } from "@/lib/record-reach";
import { OUTCOMES, type Outcome, type TaskType } from "@/lib/task-kinds";
import { cn } from "@/lib/utils";

type Item = NextAction & { reach: Reach | null };

function dateInput(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const QUICK = [
  { key: "tomorrow", days: 1 },
  { key: "in3", days: 3 },
  { key: "nextWeek", days: 7 },
] as const;

/**
 * The work list, one record at a time: who to call and their number, how it went, what
 * happens next — then the next one (§3.3). Nothing here is a second list: the rows are the
 * home's, in its order, and what is logged is the record's ordinary history.
 */
export function QueueClient({ items, canWrite }: { items: Item[]; canWrite: boolean }) {
  const t = useTranslations("workQueue");
  const tn = useTranslations("nextActions");
  const tq = useTranslations("taskOutcome");
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(0);
  const [type, setType] = useState<TaskType>("call");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [nextTitle, setNextTitle] = useState("");
  const [nextDate, setNextDate] = useState(dateInput(1));
  const [pending, startTransition] = useTransition();

  const item = items[index];

  // A fresh form for every record.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on moving to the next item only
  useEffect(() => {
    // The task's own kind: a planned call is logged as a call, a reply owed as an email.
    setType(item?.taskType ?? (item?.taskId ? "email" : "call"));
    setOutcome(null);
    setNote("");
    setNextTitle("");
    setNextDate(dateInput(1));
  }, [index]);

  const advance = (counted: boolean) => {
    if (counted) setDone((n) => n + 1);
    setIndex((i) => i + 1);
  };

  const save = () =>
    startTransition(async () => {
      if (!item) return;
      const title = nextTitle.trim();
      const next = title
        ? { type, title, dueDate: nextDate ? new Date(`${nextDate}T00:00`) : null, allDay: true }
        : null;
      try {
        if (item.taskId) {
          // A reply owed or a planned call is a task already: completing it is the record.
          await updateTaskStatus(item.taskId, "done", undefined, { outcome, note, next });
        } else if (item.reach?.target) {
          await logContactAction({ target: item.reach.target, type, outcome, note, next });
        }
        toast.success(t("logged"));
        advance(true);
      } catch {
        toast.error(t("failed"));
      }
    });

  const snooze = () =>
    startTransition(async () => {
      if (!item) return;
      try {
        await snoozeNextActionAction(item.kind, item.id, 3);
        advance(false);
      } catch {
        toast.error(t("failed"));
      }
    });

  if (!item) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-500" aria-hidden />
        <h1 className="font-bold text-2xl tracking-tight">{items.length === 0 ? t("emptyTitle") : t("doneTitle")}</h1>
        <p className="text-muted-foreground">{items.length === 0 ? t("empty") : t("doneBody", { n: done })}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard/crm">{t("backHome")}</Link>
        </Button>
      </div>
    );
  }

  const outcomes = OUTCOMES[type] as readonly Outcome[];
  const loggable = canWrite && (Boolean(item.taskId) || Boolean(item.reach?.target));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <span className="text-muted-foreground text-sm tabular-nums">
            {t("progress", { current: index + 1, total: items.length })}
          </span>
        </div>
        <Progress value={(index / items.length) * 100} aria-label={t("progressLabel")} />
      </div>

      <Card>
        <CardHeader>
          <CardDescription>{tn(PRESENTATION_KEY[item.kind])}</CardDescription>
          <CardTitle className="break-words">{item.title}</CardTitle>
          <p className="text-muted-foreground text-sm">{tn(item.detailKey, { n: item.detailValue })}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {item.reach?.name && <p className="font-medium text-sm">{item.reach.name}</p>}
          <div className="flex flex-wrap gap-2">
            {item.reach?.phone && (
              <Button asChild size="lg" className="max-sm:flex-1">
                <a href={`tel:${item.reach.phone.replace(/\s+/g, "")}`}>
                  <Phone className="mr-2 size-4" aria-hidden />
                  {item.reach.phone}
                </a>
              </Button>
            )}
            {item.reach?.email && (
              <EmailAddressButton
                email={item.reach.email}
                {...reachRecipient(item.reach)}
                canSend={canWrite}
                className={buttonVariants({ size: "lg", variant: "outline", className: "max-sm:flex-1" })}
              >
                <Mail className="mr-2 size-4" aria-hidden />
                {t("email")}
              </EmailAddressButton>
            )}
            <Button asChild size="lg" variant="ghost" className="max-sm:flex-1">
              <Link href={item.href}>
                <ExternalLink className="mr-2 size-4" aria-hidden />
                {t("openRecord")}
              </Link>
            </Button>
          </div>
          {!item.reach?.phone && !item.reach?.email && <p className="text-muted-foreground text-sm">{t("noReach")}</p>}
        </CardContent>
      </Card>

      {loggable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tq("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TaskTypePicker
              value={type}
              onChange={(v) => {
                setType(v);
                setOutcome(null);
              }}
            />
            {outcomes.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {outcomes.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    size="sm"
                    variant={outcome === o ? "default" : "outline"}
                    aria-pressed={outcome === o}
                    onClick={() => setOutcome(o)}
                  >
                    {tq(`outcomes.${o}`)}
                  </Button>
                ))}
              </div>
            )}
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tq("notePlaceholder")}
              aria-label={tq("noteLabel")}
            />
            <div className="space-y-2 rounded-lg border p-3">
              <p className="font-medium text-sm">{tq("nextLabel")}</p>
              <Input
                value={nextTitle}
                onChange={(e) => setNextTitle(e.target.value)}
                placeholder={tq("nextTitlePlaceholder")}
                aria-label={tq("nextTitleLabel")}
              />
              {nextTitle.trim() && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {QUICK.map(({ key, days }) => (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={cn("h-7 px-2 text-xs", nextDate === dateInput(days) && "bg-muted")}
                      onClick={() => setNextDate(dateInput(days))}
                    >
                      {tq(`quick.${key}`)}
                    </Button>
                  ))}
                  <Input
                    type="date"
                    value={nextDate}
                    onChange={(e) => setNextDate(e.target.value)}
                    className="h-8 w-auto"
                    aria-label={tq("dateLabel")}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => advance(false)} disabled={pending}>
          <SkipForward className="mr-2 size-4" aria-hidden />
          {t("skip")}
        </Button>
        <Button variant="outline" onClick={snooze} disabled={pending}>
          <Clock className="mr-2 size-4" aria-hidden />
          {tn("snooze3")}
        </Button>
        {loggable && (
          <Button onClick={save} disabled={pending}>
            {t("saveNext")}
            <ArrowRight className="ml-2 size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Who the email dialog writes to from a row: the record the contact is logged on, and the name
 * split so that {{nome}} fills. A deal's contact is logged on the deal.
 */
function reachRecipient(reach: Reach) {
  const [firstName, ...rest] = (reach.name ?? "").split(/\s+/);
  const person = { firstName: firstName || null, lastName: rest.join(" ") || null };
  const target = reach.target;
  if (!target) return { entity: { id: "", ...person } };
  if (target.entity === "deal") return { entity: { id: "", ...person }, dealId: target.id };
  if (target.entity === "company")
    return { entity: { id: target.id, name: reach.name }, entityType: "company" as const };
  return { entity: { id: target.id, ...person }, entityType: target.entity };
}

/** The verb each kind is read as, shared with the home's list. */
const PRESENTATION_KEY: Record<NextAction["kind"], string> = {
  sla_breached: "slaBreached",
  sla_at_risk: "slaAtRisk",
  quote_expiring: "quoteExpiring",
  quote_unopened: "quoteUnopened",
  deal_stalled: "dealStalled",
  deal_overdue: "dealOverdue",
  lead_untouched: "leadUntouched",
  customer_quiet: "customerQuiet",
  deal_no_next_step: "dealNoNextStep",
  reply_due: "replyDue",
  quote_to_order: "quoteToOrder",
  call_due: "callDue",
  lead_new: "leadNew",
};

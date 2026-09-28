import Link from "next/link";

import {
  ArrowRight,
  Headphones,
  HeadphonesIcon,
  HourglassIcon,
  SirenIcon,
  SmileIcon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth-guard";
import { type DeskTicket, deskFigures, SLA_SOON_HOURS } from "@/lib/home-dashboard-data";
import { getDb } from "@/lib/tenant-context";
import { timeLeft } from "@/lib/time-left";

import { KPI_VALUE, Kpi } from "./kpi";

/**
 * The support desk's home: whoever is looking has their own queue first, then the team's, and what is
 * closest to breaking a promise. Four statements (src/lib/home-dashboard-data.ts).
 */
export async function DeskDashboard() {
  const t = await getTranslations("crm.dashboards.desk");
  const tc = await getTranslations("common");
  const [db, actor] = await Promise.all([getDb(), getActor()]);
  const f = await deskFigures(db, actor?.userId ?? null).catch(() => null);
  const rated = f ? f.csat.good + f.csat.bad : 0;

  const list = (tickets: DeskTicket[], empty: string, showAssignee: boolean) =>
    tickets.length === 0 ? (
      <p className="py-8 text-center text-muted-foreground text-sm">{empty}</p>
    ) : (
      tickets.map((ticket) => {
        const left = timeLeft(ticket.slaDeadlineAt, tc);
        return (
          <Link
            key={ticket.id}
            href={`/dashboard/support/tickets/${ticket.id}`}
            className="group flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/60"
          >
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="shrink-0 font-mono text-muted-foreground text-xs">{ticket.ticketNumber}</span>
                <TicketStatusBadge status={ticket.status} />
                {ticket.priority && <TicketPriorityBadge priority={ticket.priority} />}
                {ticket.late && (
                  <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                    SLA
                  </Badge>
                )}
              </div>
              <p className="truncate font-medium text-sm group-hover:text-primary">{ticket.subject}</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {showAssignee && (ticket.assigneeName ?? t("nobody"))}
                {left && (
                  <span className={left.late ? "font-medium text-red-500" : undefined}>
                    {showAssignee && " · "}
                    {left.text}
                  </span>
                )}
              </p>
            </div>
          </Link>
        );
      })
    );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-3">
        <Kpi
          href="/dashboard/support/tickets"
          accent="border-l-primary"
          title={t("mine")}
          icon={<UserCheckIcon className="h-4 w-4 shrink-0 text-primary" />}
        >
          <div className={KPI_VALUE}>{f?.mine ?? 0}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("mineDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/support/tickets"
          accent="border-l-blue-500"
          title={t("open")}
          icon={<HeadphonesIcon className="h-4 w-4 shrink-0 text-blue-500" />}
        >
          <div className={KPI_VALUE}>{f?.open ?? 0}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("openDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/support/tickets"
          accent={f?.unassigned ? "border-l-amber-500" : "border-l-slate-300"}
          title={t("unassigned")}
          icon={<UserXIcon className="h-4 w-4 shrink-0 text-amber-500" />}
        >
          <div className={KPI_VALUE}>{f?.unassigned ?? 0}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("unassignedDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/support/sla"
          accent={f?.late ? "border-l-red-500" : "border-l-slate-300"}
          title={t("late")}
          icon={<SirenIcon className={`h-4 w-4 shrink-0 ${f?.late ? "text-red-500" : "text-muted-foreground"}`} />}
        >
          <div className={KPI_VALUE}>{f?.late ?? 0}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("lateDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/support/sla"
          accent={f?.dueSoon ? "border-l-orange-500" : "border-l-slate-300"}
          title={t("dueSoon")}
          icon={<HourglassIcon className="h-4 w-4 shrink-0 text-orange-500" />}
        >
          <div className={KPI_VALUE}>{f?.dueSoon ?? 0}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("dueSoonDesc", { hours: SLA_SOON_HOURS })}</p>
        </Kpi>
        <Kpi
          href="/dashboard/support/agents"
          accent="border-l-emerald-500"
          title={t("csat")}
          icon={<SmileIcon className="h-4 w-4 shrink-0 text-emerald-500" />}
        >
          <div className={KPI_VALUE}>{rated > 0 && f ? `${Math.round((f.csat.good / rated) * 100)}%` : "—"}</div>
          <p className="mt-1 text-muted-foreground text-xs">
            {rated > 0 && f ? t("csatDesc", { good: f.csat.good, bad: f.csat.bad }) : t("csatNone")}
          </p>
        </Kpi>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheckIcon className="h-4 w-4 text-muted-foreground" />
              {t("myTitle")}
            </CardTitle>
            <CardDescription>{t("myDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 px-4 pb-4">{list(f?.myNextDue ?? [], t("myNone"), false)}</CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                {t("nextTitle")}
              </CardTitle>
              <CardDescription>{t("nextDesc")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 gap-1" asChild>
              <Link href="/dashboard/support/tickets">
                {tc("all")} <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 px-4 pb-4">{list(f?.nextDue ?? [], t("noOpen"), true)}</CardContent>
        </Card>
      </div>
    </>
  );
}

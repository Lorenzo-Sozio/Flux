import Link from "next/link";

import { TrendingUp } from "lucide-react";

import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type TargetRow = { targetAmount: string; currency: string } | null;

function pctColor(pct: number) {
  if (pct >= 80) return { bar: "bg-green-500", text: "text-green-600" };
  if (pct >= 50) return { bar: "bg-yellow-400", text: "text-yellow-500" };
  return { bar: "bg-red-500", text: "text-red-500" };
}

interface Props {
  myTarget: TargetRow;
  wonThisMonth: number;
  monthLabel: string;
}

export function MonthTargetCard({ myTarget, wonThisMonth, monthLabel }: Props) {
  const target = parseFloat(myTarget?.targetAmount ?? "0");
  const currency = myTarget?.currency ?? "EUR";
  const pct = target > 0 ? Math.min(100, Math.round((wonThisMonth / target) * 100)) : null;
  const fmt = (n: number) => formatCurrency(n, { currency, maximumFractionDigits: 0 });
  const colors = pct != null ? pctColor(pct) : null;

  return (
    <Link href="/dashboard/pipeline/forecast" className="group block">
      <Card className="cursor-pointer shadow-sm transition-shadow group-hover:shadow-md">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">Obiettivo del mese</p>
              <p className="capitalize text-muted-foreground text-xs">{monthLabel}</p>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{fmt(wonThisMonth)}</span>
              <span className="text-muted-foreground">
                {target > 0 ? `su ${fmt(target)}` : "Nessun target impostato"}
              </span>
            </div>
            {target > 0 && colors && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full transition-all ${colors.bar}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>

          {pct != null && colors && (
            <div className="shrink-0 text-right">
              <span className={`font-bold text-lg ${colors.text}`}>{pct}%</span>
              <p className="text-muted-foreground text-xs">del target</p>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

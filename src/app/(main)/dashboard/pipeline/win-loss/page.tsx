import Link from "next/link";

import { ArrowLeft, Swords, Trophy, XCircle } from "lucide-react";

import { getWinLossAnalysis } from "@/actions/pipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageCapability } from "@/lib/page-guard";

/** A breakdown, drawn as a bar per row so the shape reads before the numbers do. */
function Breakdown({
  title,
  description,
  rows,
  empty,
  format,
}: {
  title: string;
  description: string;
  rows: { key: string; count: number; value: number }[];
  empty: string;
  format: (n: number) => string;
}) {
  const largest = rows.reduce((max, r) => Math.max(max, r.value), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">{empty}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{r.key}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {format(r.value)} · {r.count}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-rose-400/80"
                    style={{ width: `${largest > 0 ? Math.max(2, (r.value / largest) * 100) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Win/loss.
 *
 * The product knew how much had been lost and never why, because the reason was
 * a column nothing wrote (audit rilievo S-09). Cut three ways, because that is
 * how the question gets asked: by reason, which shows the pattern; by the stage
 * where it stopped, which says whether the problem is qualification or closing;
 * and by competitor, which is the first thing any sales meeting wants to know.
 *
 * Every cut carries value as well as count. Ten small losses and one large one
 * are different problems, and a table of counts cannot tell them apart.
 */
export default async function WinLossPage() {
  await requirePageCapability("report:read");
  const analysis = await getWinLossAnalysis();

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/pipeline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to pipeline
          </Link>
        </Button>
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Win / loss</h1>
          <p className="text-muted-foreground text-sm">Everything closed in the last twelve months.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Trophy className="h-4 w-4 text-emerald-500" /> Won
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{fmt(analysis.wonValue)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{analysis.wonCount} deals</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <XCircle className="h-4 w-4 text-rose-500" /> Lost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{fmt(analysis.lostValue)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{analysis.lostCount} deals</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Swords className="h-4 w-4 text-violet-500" /> Win rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{analysis.winRate}%</div>
            {/* Of what closed. Open deals are not losses, and counting them as
                such is how a win rate quietly stops meaning anything. */}
            <p className="mt-1 text-muted-foreground text-xs">of deals that closed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">Average loss</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">
              {fmt(analysis.lostCount ? analysis.lostValue / analysis.lostCount : 0)}
            </div>
            <p className="mt-1 text-muted-foreground text-xs">per lost deal</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Breakdown
          title="Why"
          description="The pattern, if there is one."
          rows={analysis.byReason}
          empty="No losses recorded in this period."
          format={fmt}
        />
        <Breakdown
          title="Where it stopped"
          description="Early means qualification; late means closing."
          rows={analysis.byStage}
          empty="Nothing to show yet."
          format={fmt}
        />
        <Breakdown
          title="Who won it"
          description="Named only where somebody recorded it."
          rows={analysis.byCompetitor}
          empty="Nothing to show yet."
          format={fmt}
        />
      </div>
    </div>
  );
}

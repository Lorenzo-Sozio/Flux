import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

interface Props {
  pipelineByStage: { name: string; color: string; value: number; count: number }[];
}

export async function IncomeReliability({ pipelineByStage }: Props) {
  const t = await getTranslations("finance");
  const totalValue = pipelineByStage.reduce((sum, s) => sum + s.value, 0);
  const totalCount = pipelineByStage.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{t("pipelineHealth")}</CardTitle>
          <CardDescription className="text-xs mt-0.5">{t("openDealsByStage")}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs px-2" asChild>
          <Link href="/dashboard/pipeline">{t("viewArrow")}</Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="rounded-lg bg-muted/50 p-3 space-y-0.5">
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalValue, { noDecimals: true })}</p>
          <p className="text-xs text-muted-foreground">{t("openDealsInPipeline", { count: totalCount })}</p>
        </div>

        {pipelineByStage.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("noOpenDeals")}</p>
        ) : (
          <div className="space-y-3">
            {pipelineByStage.map((stage) => {
              const pct = totalValue > 0 ? Math.round((stage.value / totalValue) * 100) : 0;
              return (
                <div key={stage.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="inline-block size-2 rounded-full" style={{ background: stage.color }} />
                      {stage.name}
                      <span className="text-muted-foreground font-normal">· {stage.count}</span>
                    </span>
                    <span className="tabular-nums font-medium">{formatCurrency(stage.value, { noDecimals: true })}</span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: stage.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

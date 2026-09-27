import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getFinanceDashboard } from "@/actions/finance";
import { getReceivables } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { requirePageCapability } from "@/lib/page-guard";

import { CashFlowOverview } from "./_components/cash-flow-overview";
import { FinanceKPICards } from "./_components/finance-kpi-cards";
import { ReceivablesCard } from "./_components/receivables-card";

export default async function FinancePage() {
  // The dashboard underneath has always required an administrator, and the page
  // had no guard at all — so everybody else reached it and met a raw error
  // instead of the redirect that says why. The money stays where it was; only
  // the way of being told changes.
  await requirePageCapability("settings:manage", "/dashboard/sales/finance");

  const [data, t, receivables] = await Promise.all([
    getFinanceDashboard(),
    getTranslations("finance"),
    // Without the sales module there are no invoices to chase: the card is simply absent.
    getReceivables().catch(() => null),
  ]);

  return (
    <div className="space-y-6">
      {/* ⚠️ Wrapping, not shrinking. `min-w-0` stopped the button being pushed off
          the screen, and then the subtitle took its place: three lines of caption
          squeezed into 140px beside a button. The button drops to its own line on
          a phone, and the sentence gets the width it was written for. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("overviewTitle")}</h1>
          <p className="mt-1 text-muted-foreground">{t("overviewSubtitle")}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pipeline">{t("viewPipeline")}</Link>
        </Button>
      </div>

      <FinanceKPICards data={data} />

      {receivables && <ReceivablesCard schedule={JSON.parse(JSON.stringify(receivables))} />}

      <CashFlowOverview revenueTrend={data.revenueTrend} />
    </div>
  );
}

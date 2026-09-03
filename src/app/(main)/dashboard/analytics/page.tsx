import Link from "next/link";

import { GitMerge } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ActionsManagerQueue } from "./_components/analytics-actions-manager-queue";
import { ActionsRiskLedger } from "./_components/analytics-actions-risk-ledger";
import { DriversCoverageTriage } from "./_components/analytics-drivers-coverage-triage";
import { DriversForecastTarget } from "./_components/analytics-drivers-forecast-target";
import { AnalyticsOverview } from "./_components/analytics-overview";

export default function Page() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* The funnel lives under the pipeline; this button pointed at
          /dashboard/analytics/funnel, which has never existed (audit rilievo D-05). */}
      <div className="flex items-center justify-between">
        <div />
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/pipeline/funnel">
            <GitMerge className="mr-2 h-4 w-4" /> Sales Funnel
          </Link>
        </Button>
      </div>
      <AnalyticsOverview />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <DriversForecastTarget />
          <DriversCoverageTriage />
        </div>
        <ActionsManagerQueue />
      </div>

      <ActionsRiskLedger />
    </div>
  );
}

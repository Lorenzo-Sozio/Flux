"use client";

import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The two dashboard charts, loaded after the page rather than with it.
 *
 * ⚠️ The chart library is the heaviest thing on the first screen after login —
 * the chunk carrying it is ~380 KB before compression — and it was imported
 * statically, so every login downloaded and parsed it before the page became
 * usable. For two charts that sit below the figures, the agenda and the work
 * list, which is what people actually open this page to read.
 *
 * `ssr: false` has to live in a client component, which is the only reason this
 * file exists; the server page imports this instead of the charts directly.
 *
 * The placeholder has the charts' exact footprint — the same two-column grid,
 * the same 300px bodies — so nothing below them jumps when they arrive.
 */
const CRMCharts = dynamic(() => import("./CRMCharts.client"), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2" aria-busy="true">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="h-[300px]">
            <Skeleton className="h-full w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  ),
});

export default CRMCharts;

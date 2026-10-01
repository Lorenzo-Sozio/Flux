"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The charts, loaded after the page rather than with it (`next/dynamic`, `ssr: false`): Recharts is
 * the largest library on these pages and draws nothing until it knows its width, so rendering it
 * on the server bought nothing and loading it with the page held the rest of the page back.
 */
export const CashFlowOverview = dynamic(() => import("./cash-flow-overview").then((m) => m.CashFlowOverview), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-xl" />,
});

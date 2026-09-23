"use client";

/**
 * The dashboard's error boundary.
 *
 * There was none anywhere in the app — 73 pages, no `error.tsx` — so any thrown
 * exception rendered Next's default white page with a digest and no way back
 * (audit rilievo B-07). Several of those exceptions were guaranteed rather than
 * hypothetical, which meant the first thing some users saw was a blank screen.
 *
 * This distinguishes the three things that actually go wrong, because they need
 * three different responses from the reader: you are not allowed (ask an admin),
 * your plan does not include this (upgrade), something broke (retry).
 */
import { useEffect } from "react";

import Link from "next/link";

import { AlertTriangle, ArrowLeft, Lock, RefreshCw, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { classifyError, type ErrorKind, shouldReloadForStaleBuild } from "@/lib/error-kind";

/**
 * ⚠️ Keys, not sentences. This page said "Something went wrong loading this
 * page" in English to every workspace, and it is the screen somebody reads
 * precisely when they are already confused.
 */
const ICONS: Record<ErrorKind, typeof Lock> = {
  forbidden: Lock,
  entitlement: Sparkles,
  stale: RefreshCw,
  unknown: AlertTriangle,
};

/** Reloads the tab, once per window — see `shouldReloadForStaleBuild`. */
function reloadOnce(): void {
  const store = typeof window === "undefined" ? undefined : window.sessionStorage;
  if (shouldReloadForStaleBuild(store)) window.location.reload();
}

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const kind = classifyError(error.message ?? "");

  useEffect(() => {
    console.error("[dashboard]", error);
    if (kind === "stale") reloadOnce();
  }, [error, kind]);

  const t = useTranslations("errorPage");
  const Icon = ICONS[kind];
  const title = t(`${kind}Title` as never);
  const hint = t(`${kind}Hint` as never);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </div>

        <h1 className="font-semibold text-xl tracking-tight">{title}</h1>

        {/* The message thrown by the guard is written for the reader — showing it
            is the whole point. Only the unknown case falls back to a generic line. */}
        {kind !== "unknown" && error.message && <p className="mt-2 text-foreground text-sm">{error.message}</p>}
        <p className="mt-2 text-muted-foreground text-sm">{hint}</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {(kind === "unknown" || kind === "stale") && (
            <Button onClick={() => (kind === "stale" ? window.location.reload() : reset())} variant="default">
              <RefreshCw className="mr-2 size-4" />
              {kind === "stale" ? t("reloadNow") : t("tryAgain")}
            </Button>
          )}
          {kind === "entitlement" && (
            <Button asChild>
              <Link href="/dashboard/settings/billing">{t("viewPlans")}</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/dashboard/crm">
              <ArrowLeft className="mr-2 size-4" />
              {t("backToDashboard")}
            </Link>
          </Button>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-[11px] text-muted-foreground">
            {t("dashboardBoundary.reference", { digest: error.digest })}
          </p>
        )}
      </div>
    </div>
  );
}

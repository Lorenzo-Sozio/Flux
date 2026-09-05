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

import { Button } from "@/components/ui/button";

type Kind = "forbidden" | "entitlement" | "unknown";

function classify(message: string): Kind {
  const m = message.toLowerCase();
  if (
    m.includes("permission") ||
    m.includes("read-only") ||
    m.includes("only workspace") ||
    m.includes("only the workspace")
  ) {
    return "forbidden";
  }
  if (m.includes("plan") || m.includes("limit") || m.includes("upgrade") || m.includes("subscription")) {
    return "entitlement";
  }
  return "unknown";
}

const COPY: Record<Kind, { icon: typeof Lock; title: string; hint: string }> = {
  forbidden: {
    icon: Lock,
    title: "You don't have access to this",
    hint: "Your role in this workspace doesn't include it. A workspace admin can change that.",
  },
  entitlement: {
    icon: Sparkles,
    title: "Your plan doesn't include this",
    hint: "Everything else keeps working. Upgrading unlocks it immediately.",
  },
  unknown: {
    icon: AlertTriangle,
    title: "Something went wrong loading this page",
    hint: "This is on our side, not yours. Retrying often works.",
  },
};

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  const kind = classify(error.message ?? "");
  const { icon: Icon, title, hint } = COPY[kind];

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

        <div className="mt-6 flex items-center justify-center gap-2">
          {kind === "unknown" && (
            <Button onClick={reset} variant="default">
              <RefreshCw className="mr-2 size-4" />
              Try again
            </Button>
          )}
          {kind === "entitlement" && (
            <Button asChild>
              <Link href="/dashboard/settings/billing">View plans</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/dashboard/crm">
              <ArrowLeft className="mr-2 size-4" />
              Back to dashboard
            </Link>
          </Button>
        </div>

        {error.digest && <p className="mt-6 font-mono text-[11px] text-muted-foreground">Reference: {error.digest}</p>}
      </div>
    </div>
  );
}

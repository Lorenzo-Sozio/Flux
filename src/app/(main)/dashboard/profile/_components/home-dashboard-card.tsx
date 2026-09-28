"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { Check, LayoutDashboard, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { setHomeDashboard } from "@/actions/preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { HomeDashboard } from "@/lib/home-dashboards";
import { cn } from "@/lib/utils";

/**
 * The dashboard the home opens on (src/lib/home-dashboards.ts), chosen by the person.
 *
 * One tap saves. "Default for your role" is a choice of its own, so somebody can go
 * back to it — and follow it if their role changes — rather than being pinned to
 * whatever the default was on the day they last touched this.
 */
export function HomeDashboardCard({
  saved,
  available,
  fallback,
}: {
  saved: HomeDashboard | null;
  available: HomeDashboard[];
  fallback: HomeDashboard;
}) {
  const t = useTranslations("crm.dashboards");
  const tp = useTranslations("profile.homeDashboard");
  const [choice, setChoice] = useState<HomeDashboard | null>(saved);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);

  const choose = (value: HomeDashboard | null) => {
    if (value === choice) return;
    const before = choice;
    setChoice(value);
    setSaving(value ?? "default");
    startTransition(async () => {
      const res = await setHomeDashboard(value).catch(() => ({ ok: false }));
      setSaving(null);
      if (res.ok) toast.success(tp("saved"));
      else {
        setChoice(before);
        toast.error(tp("saveFailed"));
      }
    });
  };

  const option = (value: HomeDashboard | null, title: string, desc: string) => {
    const on = choice === value;
    const key = value ?? "default";
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => choose(value)}
        disabled={pending}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-wait",
          on && "border-primary bg-primary/5",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
            on && "border-primary bg-primary text-primary-foreground",
          )}
          aria-hidden
        >
          {saving === key ? <Loader2 className="size-3 animate-spin" /> : on && <Check className="size-3" />}
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-sm">{title}</span>
          <span className="block text-muted-foreground text-xs">{desc}</span>
        </span>
      </button>
    );
  };

  return (
    <Card id="home-dashboard" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutDashboard className="size-5 shrink-0 text-primary" aria-hidden />
          {tp("title")}
        </CardTitle>
        <CardDescription>{tp("desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <legend className="sr-only">{tp("title")}</legend>
          {option(null, tp("default", { name: t(`${fallback}.name`) }), tp("defaultDesc"))}
          {available.map((d) => option(d, t(`${d}.name`), t(`${d}.desc`)))}
        </fieldset>
        <p className="mt-3 text-muted-foreground text-xs">
          {tp("hint")}{" "}
          <Link href="/dashboard/crm" className="font-medium text-primary hover:underline">
            {tp("open")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

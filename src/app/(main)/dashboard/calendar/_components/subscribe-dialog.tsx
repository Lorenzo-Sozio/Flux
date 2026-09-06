"use client";

import { useState } from "react";

import { AlertTriangle, CalendarSync, Check, Copy, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { getCalendarFeedUrl, getExternalCalendarUrl, setExternalCalendarUrl } from "@/actions/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Subscribing a real calendar to this workspace.
 *
 * Two things are said plainly here rather than left to be discovered, because
 * both are the kind of thing somebody finds out at the worst moment:
 *
 *  • The address is a credential. It carries no password prompt, because a
 *    calendar client cannot answer one, so whoever holds the link can read these
 *    appointments. Presented as an ordinary link, it gets forwarded.
 *  • It goes one way. Appointments booked here reach the calendar; appointments
 *    booked in the calendar do not come back. Somebody who assumes otherwise
 *    books a meeting in Google, sees nothing here, and concludes the CRM lost it.
 */
export function SubscribeDialog() {
  const t = useTranslations("calendarFeed");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // The other direction: a calendar this person keeps elsewhere, read back in.
  const [external, setExternal] = useState("");
  const [externalSaved, setExternalSaved] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load(open: boolean) {
    if (!open || url || loading) return;
    setLoading(true);
    const [result, saved] = await Promise.all([
      getCalendarFeedUrl().catch(() => ({ error: "failed" }) as const),
      getExternalCalendarUrl().catch(() => null),
    ]);
    if ("url" in result) setUrl(result.url);
    else setError(result.error);
    setExternal(saved ?? "");
    setExternalSaved(saved);
    setLoading(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some browsers and over plain HTTP. The
      // address is on screen and selectable, so there is nothing to recover from.
    }
  }

  async function saveExternal() {
    setSaving(true);
    setExternalError(null);
    const outcome = await setExternalCalendarUrl(external).catch(() => ({ ok: false, reason: "failed" }) as const);
    if (outcome.ok) setExternalSaved(external.trim() || null);
    else setExternalError(outcome.reason);
    setSaving(false);
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger asChild>
        {/* Subscribing to the feed is done once; the word costs 80px of a
            343px row, and the icon carries it below sm. */}
        <Button variant="outline" size="sm" className="gap-2" aria-label={t("subscribe")}>
          <CalendarSync className="h-4 w-4" />
          <span className="max-sm:sr-only">{t("subscribe")}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          )}

          {error && <p className="text-destructive text-sm">{t(error === "no-app-url" ? "noAppUrl" : "failed")}</p>}

          {url && (
            <>
              <div className="flex gap-2">
                <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button type="button" variant="secondary" size="icon" onClick={copy} aria-label={t("copy")}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{t("secretTitle")}</p>
                  <p className="text-muted-foreground">{t("secretBody")}</p>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-medium">{t("oneWayTitle")}</p>
                <p className="text-muted-foreground">{t("oneWayBody")}</p>
              </div>

              <div className="space-y-1 text-sm">
                <p className="font-medium">{t("howTitle")}</p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>{t("howGoogle")}</li>
                  <li>{t("howOutlook")}</li>
                  <li>{t("howApple")}</li>
                </ul>
              </div>

              {/*
                The other direction. Kept in the same window on purpose: somebody
                who has just pasted our address into Google is exactly the person
                who wants to paste Google's back, and asking them to find a second
                screen is where the second half stops happening.
              */}
              <div className="space-y-2 border-t pt-4">
                <p className="font-medium text-sm">{t("inboundTitle")}</p>
                <p className="text-muted-foreground text-xs">{t("inboundBody")}</p>
                <div className="flex gap-2">
                  <Input
                    value={external}
                    onChange={(e) => setExternal(e.target.value)}
                    placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                    className="font-mono text-xs"
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={saveExternal} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
                  </Button>
                </div>
                {externalError && <p className="text-destructive text-xs">{t(`refused.${externalError}`)}</p>}
                {!externalError && externalSaved && <p className="text-emerald-600 text-xs">{t("inboundSaved")}</p>}
                {!externalError && !externalSaved && (
                  <p className="text-muted-foreground text-xs">{t("inboundNone")}</p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

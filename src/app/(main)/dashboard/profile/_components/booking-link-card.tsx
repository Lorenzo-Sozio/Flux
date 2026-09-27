"use client";

import { useState, useTransition } from "react";

import { CalendarClock, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { type BookingLinkState, saveBookingLinkAction } from "@/actions/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { BookingSettings } from "@/lib/booking";

const DURATIONS = [15, 30, 45, 60];
const DAYS_AHEAD = [7, 14, 30, 60];
const BUFFERS = [0, 10, 15, 30];
const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"];

/**
 * The person's public booking page (src/lib/booking.ts): whether it is open, and when they
 * can be booked. The page offers only what is free in their calendar inside these hours.
 */
export function BookingLinkCard({ initial }: { initial: BookingLinkState }) {
  const t = useTranslations("profile.booking");
  const tp = useTranslations("profile");
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState<BookingSettings | null>(initial.status === "ready" ? initial.settings : null);
  const [pending, startTransition] = useTransition();

  if (state.status !== "ready" || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t(state.status === "unavailable" ? state.reason : "readOnly")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const set = <K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) =>
    setDraft({ ...draft, [key]: value });
  const toggleDay = (d: string) =>
    set(
      "weekdays",
      draft.weekdays.includes(d) ? draft.weekdays.replace(d, "") : [...draft.weekdays, d].sort().join(""),
    );

  const save = () =>
    startTransition(async () => {
      const result = await saveBookingLinkAction(draft).catch(() => null);
      if (!result?.ok) {
        toast.error(t("invalid"));
        return;
      }
      setState(result.state);
      if (result.state.status === "ready") setDraft(result.state.settings);
      toast.success(tp("saved"));
    });

  const copy = () =>
    state.address &&
    navigator.clipboard
      .writeText(state.address)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(tp("failed")));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("help")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch id="booking-on" checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
          <Label htmlFor="booking-on">{draft.enabled ? t("open") : t("closed")}</Label>
        </div>

        {state.address && (
          <div className="flex gap-2">
            <Input value={state.address} readOnly className="min-w-0 flex-1 font-mono text-xs sm:text-sm" />
            <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={t("copy")}>
              <Copy className="size-4" />
            </Button>
            <Button asChild variant="outline" size="icon" aria-label={t("preview")}>
              <a href={state.address} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="booking-title">{t("meetingTitle")}</Label>
            <Input
              id="booking-title"
              maxLength={120}
              placeholder={t("meetingTitlePlaceholder")}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("duration")}</Label>
            <Select value={String(draft.durationMinutes)} onValueChange={(v) => set("durationMinutes", Number(v))}>
              <SelectTrigger aria-label={t("duration")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("minutes", { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("daysAhead")}</Label>
            <Select value={String(draft.daysAhead)} onValueChange={(v) => set("daysAhead", Number(v))}>
              <SelectTrigger aria-label={t("daysAhead")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_AHEAD.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t("days", { count: d })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="booking-from">{t("from")}</Label>
            <Input
              id="booking-from"
              type="time"
              step={900}
              value={draft.dayStart}
              onChange={(e) => set("dayStart", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="booking-to">{t("to")}</Label>
            <Input
              id="booking-to"
              type="time"
              step={900}
              value={draft.dayEnd}
              onChange={(e) => set("dayEnd", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("buffer")}</Label>
            <Select value={String(draft.bufferMinutes)} onValueChange={(v) => set("bufferMinutes", Number(v))}>
              <SelectTrigger aria-label={t("buffer")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUFFERS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m === 0 ? t("noBuffer") : t("minutes", { count: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="font-medium text-sm">{t("weekdays")}</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d) => (
              <div key={d} className="flex items-center gap-1.5">
                <Checkbox
                  id={`booking-day-${d}`}
                  checked={draft.weekdays.includes(d)}
                  onCheckedChange={() => toggleDay(d)}
                />
                <Label htmlFor={`booking-day-${d}`} className="font-normal text-sm">
                  {t(`weekday.${d}` as never)}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>

        <p className="text-muted-foreground text-xs">{t("whatHappens")}</p>
        <Button onClick={save} disabled={pending}>
          {tp("save")}
        </Button>
      </CardContent>
    </Card>
  );
}

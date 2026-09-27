"use client";

import { useMemo, useState, useTransition } from "react";

import { CalendarCheck, Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BookingPage } from "@/lib/booking-public";
import { cn } from "@/lib/utils";

const ERRORS = ["taken", "invalid", "tooMany", "notFound"];

/** A calendar date, `YYYY-MM-DD`, of an instant on the workspace's clock. */
function dayOn(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

/**
 * Pick a day, pick a time, say who you are. Times are shown on the workspace's clock and
 * say so: a visitor abroad reads "10:00 (Europe/Rome)" rather than a time shifted without
 * a word.
 */
export function BookingClient({ workspace, token, page }: { workspace: string; token: string; page: BookingPage }) {
  const t = useTranslations("booking");
  const format = useFormatter();
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "", website: "" });

  const zone = page.timeZone;
  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of page.slots) {
      const key = dayOn(s, zone);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [page.slots, zone]);
  const days = [...byDay.keys()];
  const shownDay = day ?? days[0] ?? null;

  const time = (iso: string) => format.dateTime(new Date(iso), { timeZone: zone, hour: "2-digit", minute: "2-digit" });
  const longDay = (key: string) =>
    format.dateTime(new Date(`${key}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace, token, start: slot, ...form }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => null) : null;
      if (body?.ok) {
        setBooked(slot);
        return;
      }
      const reason = typeof body?.reason === "string" && ERRORS.includes(body.reason) ? body.reason : "failed";
      setError(t(`errors.${reason}` as never));
      if (reason === "taken") setSlot(null);
    });

  if (booked) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center p-4">
        <Card className="w-full">
          <CardHeader className="items-center text-center">
            <CalendarCheck className="size-10 text-emerald-600" aria-hidden />
            <CardTitle>{t("confirmedTitle")}</CardTitle>
            <CardDescription>
              {t("confirmedBody", {
                name: page.ownerName,
                day: longDay(dayOn(booked, zone)),
                time: time(booked),
                zone,
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 sm:py-10">
      <div className="space-y-1">
        <h1 className="font-bold text-2xl tracking-tight">{page.title || t("pageTitle", { name: page.ownerName })}</h1>
        <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
          <Clock className="size-4 shrink-0" aria-hidden />
          {t("duration", { minutes: page.durationMinutes, name: page.ownerName, zone })}
        </p>
      </div>

      {days.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">{t("noSlots")}</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={d === shownDay}
                  onClick={() => {
                    setDay(d);
                    setSlot(null);
                  }}
                  className={cn(
                    "shrink-0 rounded-md border px-3 py-2 text-left text-sm capitalize",
                    d === shownDay ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted",
                  )}
                >
                  {longDay(d)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {(shownDay ? (byDay.get(shownDay) ?? []) : []).map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={s === slot ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSlot(s)}
                  aria-pressed={s === slot}
                >
                  {time(s)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {slot && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("formTitle", { day: longDay(dayOn(slot, zone)), time: time(slot) })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="b-name">{t("name")}</Label>
                  <Input
                    id="b-name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-email">{t("email")}</Label>
                  <Input
                    id="b-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-phone">{t("phone")}</Label>
                  <Input
                    id="b-phone"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-note">{t("note")}</Label>
                <Textarea
                  id="b-note"
                  rows={3}
                  maxLength={2000}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              {/* No person sees or fills this; a script does. */}
              <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="b-website">Website</label>
                <input
                  id="b-website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <p className="text-muted-foreground text-xs">{t("privacy", { name: page.ownerName })}</p>
              <Button type="submit" disabled={pending || !form.name.trim() || !form.email.trim()}>
                {t("confirm")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { CalendarOff, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { addBusinessHolidayAction, removeBusinessHolidayAction, saveBusinessCalendarAction } from "@/actions/support";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { WeekSchedule } from "@/lib/business-hours";

/** Indexed the way `Date.getDay()` indexes, so Sunday is first. */
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Minutes from midnight as "HH:MM", and back. */
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const toMinutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

export interface Holiday {
  id: string;
  day: string;
  name: string | null;
}

/**
 * When the office is open.
 *
 * This is what stops a four-hour promise on a Friday-evening ticket from expiring
 * at nine that night, with nobody there, and the team reading on Monday that they
 * missed it (audit rilievo S-07). It only takes effect on the policies that ask
 * for working hours, which is why the switch is on each policy above rather than
 * here.
 */
export function BusinessHoursCard({
  timeZone: initialTimeZone,
  week: initialWeek,
  holidays: initialHolidays,
  ready = true,
}: {
  timeZone: string;
  week: WeekSchedule;
  holidays: Holiday[];
  /** False until the workspace database has the tables. */
  ready?: boolean;
}) {
  const [week, setWeek] = useState<WeekSchedule>(initialWeek);
  const [holidays, setHolidays] = useState<Holiday[]>(initialHolidays);
  const [newDay, setNewDay] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, startSaving] = useTransition();
  const t = useTranslations("businessHours");

  const setDay = (index: number, next: { openMinute: number; closeMinute: number } | null) =>
    setWeek((prev) => prev.map((d, i) => (i === index ? next : d)));

  const save = () =>
    startSaving(async () => {
      try {
        await saveBusinessCalendarAction({ week });
        toast.success(t("saved"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("saveFailed"));
      }
    });

  const addHoliday = () =>
    startSaving(async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDay)) {
        toast.error(t("pickDate"));
        return;
      }
      try {
        await addBusinessHolidayAction(newDay, newName);
        setHolidays((prev) =>
          [...prev, { id: `pending-${newDay}`, day: newDay, name: newName || null }].sort((a, b) =>
            a.day.localeCompare(b.day),
          ),
        );
        setNewDay("");
        setNewName("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("addFailed"));
      }
    });

  const removeHoliday = (id: string) =>
    startSaving(async () => {
      try {
        await removeBusinessHolidayAction(id);
        setHolidays((prev) => prev.filter((h) => h.id !== id));
      } catch {
        toast.error(t("removeFailed"));
      }
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/*
          Saying so beats offering an editor whose Save would fail. The tables
          arrive with a migration somebody runs by hand from the admin panel.
        */}
        {!ready && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 text-sm dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t("notMigrated")}
          </div>
        )}

        {/* ⚠️ Shown, not edited, here: the zone governs the whole workspace — calendar,
            reminders, every date in the reports — and it lives in Settings → General,
            where a workspace without the support module can reach it too. */}
        <p className="text-muted-foreground text-sm">
          {t.rich("timeZoneElsewhere", {
            zone: initialTimeZone,
            b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
            link: (chunks) => (
              <Link href="/dashboard/settings/general" className="text-primary underline-offset-2 hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>

        <div className="space-y-2">
          {/* Monday first: the week as it is worked, not as the array is indexed. */}
          {[1, 2, 3, 4, 5, 6, 0].map((index) => {
            const day = week[index];
            return (
              <div key={index} className="flex flex-wrap items-center gap-3">
                <Switch
                  id={`day-${index}`}
                  checked={day !== null}
                  onCheckedChange={(on) => setDay(index, on ? { openMinute: 9 * 60, closeMinute: 18 * 60 } : null)}
                />
                <Label htmlFor={`day-${index}`} className="w-24 shrink-0 font-normal text-sm">
                  {t(DAY_KEYS[index])}
                </Label>

                {/* The two times do not fit beside the day on a phone, so below sm
                    they take a line of their own, indented under the day name
                    (the switch is 2rem, plus the row's gap). */}
                {day ? (
                  <div className="flex items-center gap-2 max-sm:basis-full max-sm:pl-11">
                    <Input
                      type="time"
                      className="h-9 min-w-0 flex-1 tabular-nums sm:h-8 sm:w-28 sm:flex-none"
                      value={toTime(day.openMinute)}
                      onChange={(e) => {
                        const m = toMinutes(e.target.value);
                        if (m !== null) setDay(index, { ...day, openMinute: m });
                      }}
                    />
                    <span className="text-muted-foreground text-xs">{t("to")}</span>
                    <Input
                      type="time"
                      className="h-9 min-w-0 flex-1 tabular-nums sm:h-8 sm:w-28 sm:flex-none"
                      value={toTime(day.closeMinute)}
                      onChange={(e) => {
                        const m = toMinutes(e.target.value);
                        if (m !== null) setDay(index, { ...day, closeMinute: m });
                      }}
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">{t("closed")}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("save")}
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <p className="flex items-center gap-2 font-medium text-sm">
              <CalendarOff className="h-4 w-4 text-muted-foreground" />
              {t("holidaysTitle")}
            </p>
            <p className="text-muted-foreground text-xs">{t("holidaysHint")}</p>
          </div>

          {holidays.length > 0 && (
            <ul className="divide-y rounded-md border">
              {holidays.map((holiday) => (
                <li key={holiday.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="shrink-0 font-mono text-sm tabular-nums">{holiday.day}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">{holiday.name ?? ""}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground hover:text-destructive sm:size-7"
                    onClick={() => removeHoliday(holiday.id)}
                    disabled={saving}
                    aria-label={t("remove", { day: holiday.day })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Below sm the date takes a row and the name shares the next with Add:
              beside a 160px date and the button, the name field was squeezed
              to a sliver. */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5 max-sm:basis-full">
              <Label htmlFor="holiday-day" className="text-xs">
                {t("date")}
              </Label>
              <Input
                id="holiday-day"
                type="date"
                className="h-9 w-full sm:h-8 sm:w-40"
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
              />
            </div>
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor="holiday-name" className="text-xs">
                {t("name")}
              </Label>
              <Input
                id="holiday-name"
                className="h-9 sm:h-8"
                placeholder={t("optional")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5 sm:h-8"
              onClick={addHoliday}
              disabled={saving}
            >
              <Plus className="h-3.5 w-3.5" /> {t("add")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

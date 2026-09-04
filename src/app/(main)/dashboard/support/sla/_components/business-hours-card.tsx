"use client";

import { useState, useTransition } from "react";

import { CalendarOff, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { addBusinessHolidayAction, removeBusinessHolidayAction, saveBusinessCalendarAction } from "@/actions/support";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { WeekSchedule } from "@/lib/business-hours";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [week, setWeek] = useState<WeekSchedule>(initialWeek);
  const [holidays, setHolidays] = useState<Holiday[]>(initialHolidays);
  const [newDay, setNewDay] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, startSaving] = useTransition();

  const setDay = (index: number, next: { openMinute: number; closeMinute: number } | null) =>
    setWeek((prev) => prev.map((d, i) => (i === index ? next : d)));

  const save = () =>
    startSaving(async () => {
      try {
        await saveBusinessCalendarAction({ timeZone, week });
        toast.success("Opening hours saved.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save the opening hours.");
      }
    });

  const addHoliday = () =>
    startSaving(async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDay)) {
        toast.error("Pick a date first.");
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
        toast.error(err instanceof Error ? err.message : "Could not add the holiday.");
      }
    });

  const removeHoliday = (id: string) =>
    startSaving(async () => {
      try {
        await removeBusinessHolidayAction(id);
        setHolidays((prev) => prev.filter((h) => h.id !== id));
      } catch {
        toast.error("Could not remove the holiday.");
      }
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Opening hours
        </CardTitle>
        <CardDescription>
          Policies set to working hours count only the time inside these windows, so a promise made on a Friday evening
          is not broken overnight.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/*
          Saying so beats offering an editor whose Save would fail. The tables
          arrive with a migration somebody runs by hand from the admin panel.
        */}
        {!ready && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900 text-sm dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            The workspace database has not been migrated for this yet, so these are the defaults and cannot be saved.
            Run <span className="font-medium">Migrate DB</span> from the platform admin panel, then reload.
          </div>
        )}

        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="tz" className="text-xs">
            Time zone
          </Label>
          <Input id="tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Europe/Rome" />
          <p className="text-muted-foreground text-xs">An IANA name, such as Europe/Rome or America/New_York.</p>
        </div>

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
                  {DAY_NAMES[index]}
                </Label>

                {day ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      className="h-8 w-28 tabular-nums"
                      value={toTime(day.openMinute)}
                      onChange={(e) => {
                        const m = toMinutes(e.target.value);
                        if (m !== null) setDay(index, { ...day, openMinute: m });
                      }}
                    />
                    <span className="text-muted-foreground text-xs">to</span>
                    <Input
                      type="time"
                      className="h-8 w-28 tabular-nums"
                      value={toTime(day.closeMinute)}
                      onChange={(e) => {
                        const m = toMinutes(e.target.value);
                        if (m !== null) setDay(index, { ...day, closeMinute: m });
                      }}
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">Closed</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save hours
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <p className="flex items-center gap-2 font-medium text-sm">
              <CalendarOff className="h-4 w-4 text-muted-foreground" />
              Days the office is shut
            </p>
            <p className="text-muted-foreground text-xs">Public holidays and closures. The clock stops on these.</p>
          </div>

          {holidays.length > 0 && (
            <ul className="divide-y rounded-md border">
              {holidays.map((holiday) => (
                <li key={holiday.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="font-mono text-sm tabular-nums">{holiday.day}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">{holiday.name ?? ""}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeHoliday(holiday.id)}
                    disabled={saving}
                    aria-label={`Remove ${holiday.day}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="holiday-day" className="text-xs">
                Date
              </Label>
              <Input
                id="holiday-day"
                type="date"
                className="h-8 w-40"
                value={newDay}
                onChange={(e) => setNewDay(e.target.value)}
              />
            </div>
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="holiday-name" className="text-xs">
                Name
              </Label>
              <Input
                id="holiday-name"
                className="h-8"
                placeholder="Optional"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={addHoliday} disabled={saving}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

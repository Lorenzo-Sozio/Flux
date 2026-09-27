"use client";

import { useEffect, useMemo, useState } from "react";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { type BusySlot, getColleagueAvailability } from "@/actions/appointments";
import { addMinutesToWall, toWallDate, wallMinutes } from "@/lib/wall-clock";

interface Props {
  userIds: string[];
  users: { id: string; name: string | null }[];
  date: string; // yyyy-MM-dd on the workspace's clock
  /** The workspace's zone: the busy times and the slots are read on its clock. */
  timeZone: string;
  onSelect: (startAt: string, endAt: string) => void; // wall-clock values on that clock
}

const SLOTS = (() => {
  const out: { label: string; hour: number; minute: number }[] = [];
  for (let h = 8; h <= 19; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 19 && m > 0) break;
      out.push({
        label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        hour: h,
        minute: m,
      });
    }
  }
  return out;
})();

function overlaps(slots: BusySlot[], h: number, m: number, date: string, timeZone: string): boolean {
  const slotStart = h * 60 + m;
  const slotEnd = slotStart + 30;
  return slots.some((b) => {
    // A meeting that began the day before, or runs into the next, covers the edge of this one.
    const bs = toWallDate(b.startAt, timeZone) < date ? 0 : wallMinutes(b.startAt, timeZone);
    const be = toWallDate(b.endAt, timeZone) > date ? 1440 : wallMinutes(b.endAt, timeZone);
    return slotStart < be && slotEnd > bs;
  });
}

export function AvailabilityPicker({ userIds, users, date, timeZone, onSelect }: Props) {
  const t = useTranslations("appointment.availability");
  const tc = useTranslations("common");
  const userIdsKey = userIds.join(",");
  const [busy, setBusy] = useState<Record<string, BusySlot[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = userIdsKey.split(",").filter(Boolean);
    if (ids.length === 0 || !date) return;
    setLoading(true);
    getColleagueAvailability(ids, date)
      .then(setBusy)
      .finally(() => setLoading(false));
  }, [userIdsKey, date]);

  const visibleUsers = useMemo(() => users.filter((u) => userIds.includes(u.id)), [users, userIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (visibleUsers.length === 0) return null;

  return (
    <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-lg border bg-card">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            <th className="px-2 py-2 text-left font-semibold text-muted-foreground text-xs">{t("time")}</th>
            {visibleUsers.map((u) => (
              <th key={u.id} className="max-w-[80px] truncate px-2 py-2 text-center font-semibold text-xs">
                {u.name ?? "?"}
              </th>
            ))}
            <th className="w-20 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot) => {
            const busyFlags = visibleUsers.map((u) =>
              overlaps(busy[u.id] ?? [], slot.hour, slot.minute, date, timeZone),
            );
            const allFree = busyFlags.every((f) => !f);
            return (
              <tr key={slot.label} className="border-t">
                <td className="px-2 py-1.5 font-mono text-muted-foreground text-xs tabular-nums">{slot.label}</td>
                {visibleUsers.map((u, idx) => (
                  <td key={u.id} className="px-2 py-1.5 text-center">
                    {busyFlags[idx] ? (
                      <span
                        role="img"
                        className="inline-block h-2.5 w-2.5 rounded-full bg-red-400"
                        title={t("busy")}
                        aria-label={t("busy")}
                      />
                    ) : (
                      <span
                        role="img"
                        className="inline-block h-2.5 w-2.5 rounded-full bg-green-400"
                        aria-label={t("free")}
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  {allFree && (
                    <button
                      type="button"
                      onClick={() => {
                        const start = `${date}T${slot.label}`;
                        onSelect(start, addMinutesToWall(start, 60));
                      }}
                      className="rounded bg-green-100 px-2 py-0.5 font-medium text-[10px] text-green-700 transition-colors hover:bg-green-200 dark:bg-green-950/40 dark:text-green-300 dark:hover:bg-green-950/60"
                    >
                      {tc("select")}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

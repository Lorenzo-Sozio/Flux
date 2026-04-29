"use client";

import { useEffect, useMemo, useState } from "react";

import { Loader2 } from "lucide-react";

import { type BusySlot, getColleagueAvailability } from "@/actions/appointments";

interface Props {
  userIds: string[];
  users: { id: string; name: string | null }[];
  date: string; // yyyy-MM-dd
  onSelect: (startAt: string, endAt: string) => void; // datetime-local values
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

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` + `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function overlaps(slots: BusySlot[], h: number, m: number): boolean {
  const slotStart = h * 60 + m;
  const slotEnd = slotStart + 30;
  return slots.some((b) => {
    const bs = b.startAt.getHours() * 60 + b.startAt.getMinutes();
    const be = b.endAt.getHours() * 60 + b.endAt.getMinutes();
    return slotStart < be && slotEnd > bs;
  });
}

export function AvailabilityPicker({ userIds, users, date, onSelect }: Props) {
  const userIdsKey = userIds.join(",");
  const [busy, setBusy] = useState<Record<string, BusySlot[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = userIdsKey.split(",").filter(Boolean);
    if (ids.length === 0 || !date) return;
    setLoading(true);
    getColleagueAvailability(ids, new Date(date))
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
            <th className="px-2 py-2 text-left font-semibold text-muted-foreground text-xs">Ora</th>
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
            const busyFlags = visibleUsers.map((u) => overlaps(busy[u.id] ?? [], slot.hour, slot.minute));
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
                        title="Occupato"
                        aria-label="Occupato"
                      />
                    ) : (
                      <span
                        role="img"
                        className="inline-block h-2.5 w-2.5 rounded-full bg-green-400"
                        aria-label="Libero"
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  {allFree && (
                    <button
                      type="button"
                      onClick={() => {
                        const start = new Date(`${date}T${slot.label}:00`);
                        const end = new Date(start);
                        end.setHours(end.getHours() + 1);
                        onSelect(toLocalDatetime(start), toLocalDatetime(end));
                      }}
                      className="rounded bg-green-100 px-2 py-0.5 font-medium text-[10px] text-green-700 transition-colors hover:bg-green-200 dark:bg-green-950/40 dark:text-green-300 dark:hover:bg-green-950/60"
                    >
                      Seleziona
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

"use client";

import { useEffect, useState } from "react";

import { wallMinutes } from "@/lib/wall-clock";

/**
 * The red "now" line. Read on the clock the grid is drawn on — the workspace's —
 * so it crosses the meeting that is actually happening, not the one an hour away
 * in the browser's zone.
 */
export function WeekCurrentTimeLine({
  hourStart,
  hourHeight,
  hourEnd = 24,
  timeZone,
}: {
  hourStart: number;
  hourHeight: number;
  hourEnd?: number;
  timeZone?: string;
}) {
  const [topPx, setTopPx] = useState<number | null>(null);

  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const mins = timeZone ? wallMinutes(now, timeZone) : now.getHours() * 60 + now.getMinutes();
      if (mins > hourEnd * 60) return setTopPx(null);
      setTopPx(((mins - hourStart * 60) / 60) * hourHeight);
    };
    calc();
    const id = setInterval(calc, 60_000);
    return () => clearInterval(id);
  }, [hourStart, hourHeight, hourEnd, timeZone]);

  if (topPx === null || topPx < 0) return null;

  return (
    <div className="pointer-events-none absolute right-0 left-0 z-10" style={{ top: `${topPx}px` }}>
      <div className="flex items-center">
        <div className="-ml-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
        <div className="h-px flex-1 bg-red-500 opacity-80" />
      </div>
    </div>
  );
}

"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { NEW_APPOINTMENT_EVENT, type NewAppointmentDetail } from "./appointment-format";

function askForAppointment(start: string, allDay = false) {
  window.dispatchEvent(new CustomEvent<NewAppointmentDetail>(NEW_APPOINTMENT_EVENT, { detail: { start, allDay } }));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Half-hour targets behind the appointments of one day column: clicking an empty
 * slot opens the create form at that time. Drawn before the events, so an
 * appointment on top still receives its own click.
 */
export function CalendarSlotLayer({
  day,
  hourStart,
  hourEnd,
  hourHeight,
}: {
  day: string; // yyyy-MM-dd
  hourStart: number;
  hourEnd: number;
  hourHeight: number;
}) {
  const t = useTranslations("calendar");
  const slots: { h: number; m: number }[] = [];
  for (let h = hourStart; h < hourEnd; h++) {
    slots.push({ h, m: 0 }, { h, m: 30 });
  }
  return (
    <>
      {slots.map(({ h, m }) => {
        const time = `${pad(h)}:${pad(m)}`;
        return (
          <button
            key={time}
            type="button"
            aria-label={t("newAppointmentAt", { time })}
            onClick={() => askForAppointment(`${day}T${time}`)}
            className="group absolute right-0 left-0 flex items-start justify-end px-1 pt-0.5 transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none"
            style={{ top: `${((h - hourStart) * 60 + m) * (hourHeight / 60)}px`, height: `${hourHeight / 2}px` }}
          >
            <span className="hidden text-[10px] text-primary/70 tabular-nums group-hover:inline">{time}</span>
          </button>
        );
      })}
    </>
  );
}

/** The small "+" in a month cell (at nine) or in the all-day strip (all day). */
export function NewOnDayButton({ day, allDay = false }: { day: string; allDay?: boolean }) {
  const t = useTranslations("calendar");
  return (
    <button
      type="button"
      aria-label={allDay ? t("newAllDayOn") : t("newAppointmentOn")}
      onClick={() => askForAppointment(allDay ? day : `${day}T09:00`, allDay)}
      className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );
}

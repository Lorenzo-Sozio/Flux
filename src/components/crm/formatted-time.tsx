"use client";

import { useEffect, useState } from "react";

export function FormattedTime({ date }: { date: Date | string | null }) {
  const [formatted, setFormatted] = useState<string>("");

  useEffect(() => {
    if (!date) return;
    const d = new Date(date);
    setFormatted(
      d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
  }, [date]);

  if (!formatted) return null;

  return <span>{formatted}</span>;
}

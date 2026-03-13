"use client";

import { useEffect, useState } from "react";

export function FormattedDate({ date, includeTime = true }: { date: Date | string | null; includeTime?: boolean }) {
  const [formatted, setFormatted] = useState<string>("");

  useEffect(() => {
    if (!date) return;
    const d = new Date(date);
    setFormatted(
      d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: includeTime ? "short" : undefined,
      })
    );
  }, [date, includeTime]);

  // Return an empty span or a placeholder during SSR to avoid hydration mismatch
  if (!formatted) return <span className="opacity-0">...</span>;

  return <span>{formatted}</span>;
}

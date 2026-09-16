"use client";

import { useEffect } from "react";

import { useSearchParams } from "next/navigation";

/**
 * Opens a create form when the page is reached with `?new=true`.
 *
 * Quick create and the palette link to list pages that way. Five of those links
 * pointed at pages that never read the parameter, so "New ticket" landed on the
 * ticket list and nothing happened. `enabled` belongs to one instance per page:
 * a list with a header button and an empty-state button must open one form, not two.
 */
export function useOpenOnNew(enabled: boolean, open: (value: boolean) => void) {
  const searchParams = useSearchParams();
  useEffect(() => {
    if (enabled && searchParams?.get("new") === "true") open(true);
  }, [enabled, searchParams, open]);
}

"use client";

import { useEffect } from "react";

/**
 * Writes `owners=<me>` into the address the board was opened without, so the filter bar shows the
 * filter the server already applied. Through the browser's history, which Next follows without
 * asking the server again: the redirect this replaced made every tap on Pipeline two renders.
 */
export function DefaultOwnersParam({ userId }: { userId: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("owners")) return;
    url.searchParams.set("owners", userId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [userId]);
  return null;
}

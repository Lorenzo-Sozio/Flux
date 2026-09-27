"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this person asked to see every section in the menu, rather than the day's work
 * first (§4.1; `audience` in sidebar-items.ts).
 *
 * A preference of this browser, like the phone's shortcuts: it changes what is listed,
 * never what may be opened — the palette finds every section either way, and a page's
 * guard is its own.
 */

const KEY = "flux:nav-full:v1";
const EVENT = "flux:nav-full-changed";

function snapshot(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useFullMenu(): { full: boolean; setFull: (full: boolean) => void } {
  // The server renders the focused menu; the browser switches after hydration if asked.
  const full = useSyncExternalStore(subscribe, snapshot, () => false);
  const setFull = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
    } catch {
      // Private mode: the toggle still works for this page.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { full, setFull };
}

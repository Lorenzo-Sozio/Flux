"use client";

import { useCallback, useSyncExternalStore } from "react";

import { MOBILE_TAB_PREFERENCE } from "@/navigation/sidebar/sidebar-items";

/**
 * Which shortcuts a person pinned to the phone's bottom bar.
 *
 * A convenience of this device, so it lives in this browser rather than on the
 * account: the three places somebody uses on their phone are not the ones they
 * use at a desk. ⚠️ It is only ever an *order* handed to `pickMobileTabs`, which
 * looks each url up in the menu already filtered for role and plan — a stored
 * url the person may no longer open is not found, and costs nothing.
 */

const KEY = "flux:mobile-tabs:v1";
const EVENT = "flux:mobile-tabs-changed";

function read(): string[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((u) => typeof u === "string") ? parsed : null;
  } catch {
    return null;
  }
}

let cache: { raw: string | null; value: string[] | null } = { raw: null, value: null };

function snapshot(): string[] | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  // The same array for the same stored text, or React re-renders forever.
  if (raw !== cache.raw) cache = { raw, value: read() };
  return cache.value;
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

/**
 * The preference order for the bar: the pinned shortcuts first, then the
 * defaults, so a bar with a pinned page that became unavailable still fills up.
 */
export function useMobileTabPreference(): {
  pinned: string[] | null;
  preference: string[];
  setPinned: (urls: string[] | null) => void;
} {
  const pinned = useSyncExternalStore(subscribe, snapshot, () => null);
  const setPinned = useCallback((urls: string[] | null) => {
    try {
      if (urls === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, JSON.stringify(urls));
    } catch {
      // Private mode or storage switched off: the defaults keep working.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  const preference = pinned ? [...new Set([...pinned, ...MOBILE_TAB_PREFERENCE])] : [...MOBILE_TAB_PREFERENCE];
  return { pinned, preference, setPinned };
}

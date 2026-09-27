"use client";

import { useSearchParams } from "next/navigation";

/**
 * Which appointment the detail panel shows, kept in the URL without a round trip.
 *
 * ⚠️ Opening one used to be a navigation: the page re-rendered on the server,
 * which re-ran every query of the calendar — tasks, activities, appointments and
 * the external calendar — to open a panel that then fetched its one row anyway.
 * `history.pushState` changes the URL and `useSearchParams` follows it (the
 * router is told), so a click costs one read. The link keeps its `href`, so a
 * new tab, a copied link and a page without JavaScript still work.
 *
 * The panel being an entry in the history is also what makes the back button,
 * and Android's back gesture, close it instead of leaving the calendar.
 */

/** Whether the open panel was opened here, so there is an entry of ours to go back over. */
let openedByPush = false;

export function useSelectedAppointment(): { id: string | null; occurrence: string | null } {
  const params = useSearchParams();
  return { id: params.get("appointment"), occurrence: params.get("occurrence") };
}

function isAppointmentHref(href: string): boolean {
  try {
    return new URL(href, window.location.href).searchParams.has("appointment");
  } catch {
    return false;
  }
}

/** Shows the appointment an href names. Switching between two replaces rather than stacks. */
export function openAppointmentHref(href: string) {
  const url = new URL(href, window.location.href);
  const alreadyOpen = new URL(window.location.href).searchParams.has("appointment");
  if (alreadyOpen) {
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  } else {
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    openedByPush = true;
  }
}

/**
 * The panel closed some other way — the view or the date changed and took the
 * parameter with it. Our entry is no longer the one on top, so going back over
 * it would leave the calendar instead.
 */
export function forgetOpenedEntry() {
  openedByPush = false;
}

/** Closes the panel: back over our own entry, or drop the parameters from one we did not make. */
export function closeAppointment() {
  if (openedByPush) {
    openedByPush = false;
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("appointment");
  url.searchParams.delete("occurrence");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * The click handler for a link to an appointment: an ordinary click opens the
 * panel in place; a middle click, or one with a modifier, is the browser's.
 */
export function onAppointmentLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!isAppointmentHref(href)) return;
  e.preventDefault();
  openAppointmentHref(href);
}

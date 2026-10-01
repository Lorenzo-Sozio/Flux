"use client";

import { useEffect, useRef } from "react";

/** The history entries the open layers pushed, innermost last. */
type Layered = { fluxLayers?: string[] } | null;

const PHONE = "(max-width: 767px)";

const layersOf = (state: unknown): string[] => (state as Layered)?.fluxLayers ?? [];

/** What of `window` this needs, so a test can hand in its own history. */
export interface BackDismissWindow {
  history: Pick<History, "state" | "pushState" | "back">;
  addEventListener(type: "popstate", listener: (event: PopStateEvent) => void): void;
  removeEventListener(type: "popstate", listener: (event: PopStateEvent) => void): void;
  setTimeout(handler: () => void, ms: number): unknown;
}

/**
 * Pushes the layer's history entry and closes the layer when Back takes it away. Returns the
 * cleanup, which takes the entry back off when the layer was closed some other way.
 */
export function attachBackDismiss(win: BackDismissWindow, close: () => void, id: string): () => void {
  const below = layersOf(win.history.state);
  // The URL is left as it is: Next keeps its own state beside this when the URL does not change.
  win.history.pushState({ ...((win.history.state as object | null) ?? {}), fluxLayers: [...below, id] }, "");

  let gone = false;
  const onPop = (event: PopStateEvent) => {
    if (gone || layersOf(event.state).includes(id)) return;
    gone = true;
    close();
  };
  win.addEventListener("popstate", onPop);
  return () => {
    win.removeEventListener("popstate", onPop);
    if (gone) return;
    // A moment later, not now: React's development double mount unmounts and mounts again at
    // once, and the new mount's entry must be on top before this one decides it is.
    win.setTimeout(() => {
      // Still the entry this layer pushed, on top: closed by its own button, so its entry goes too.
      if (layersOf(win.history.state).at(-1) === id) win.history.back();
    }, 0);
  };
}

/**
 * On a phone, the system's Back button closes what is open on top of the page — a full-screen
 * dialog, the notifications, the recents, a sheet, the Menu hub — instead of leaving the page under
 * it. That is what Back does in every app, and an installed PWA has no other: on Android the button
 * closed nothing and took the person off the page they were working on.
 *
 * Mounted with the layer's content (which exists only while it is open): it pushes one history
 * entry naming the layer and closes the layer when Back takes that entry away. Closed any other way
 * (its X, a row tapped), it takes its own entry back off, so the next Back does what it should.
 *
 * ⚠️ Layers nest — the template list over the email dialog. Each entry carries the whole stack of
 * open layers, and on Back only the layers missing from the entry Back arrived at close: the dialog
 * underneath stays open.
 *
 * ⚠️ A layer closed by navigating away (a notification tapped opens its record) leaves its entry
 * behind the new page; the history entry then already belongs to the new page and is not touched.
 *
 * Desktop is left alone: there Back is a page's, and Escape and the overlay close a dialog.
 */
export function useBackDismiss(close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia(PHONE).matches) return;
    return attachBackDismiss(window, () => closeRef.current(), Math.random().toString(36).slice(2));
  }, []);
}

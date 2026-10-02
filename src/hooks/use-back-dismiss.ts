"use client";

import { useEffect, useRef } from "react";

const PHONE = "(max-width: 767px)";

/** What of `window` this needs, so a test can hand in its own history. */
export interface BackDismissWindow {
  history: Pick<History, "state" | "pushState" | "go">;
  location: Pick<Location, "href">;
  addEventListener(type: "popstate", listener: () => void): void;
}

/**
 * The layers open now, innermost last, and the history entries left behind by layers closed.
 *
 * ⚠️⚠️ **Nothing here is written into `history.state`.** The first version wrote the open layers
 * into the entry it pushed, and Next's router rewrites the current entry's state on every refresh
 * of the page (a server action, a poll, `router.refresh()`): the layers vanished, entries were left
 * orphaned, and Back stopped closing anything after a few uses. History entries carry nothing; the
 * count is kept here.
 *
 * ⚠️⚠️ **Closing a layer never moves the history.** The second version took a layer's entry back
 * off with `history.back()` as it closed — and a Back is a navigation to Next: it discards whatever
 * the router has in flight. A record saved in its edit dialog closes the dialog and refreshes the
 * page in the same instant, and the refresh was thrown away; a link followed from the Menu closes
 * the Menu while the new page is on its way, and the navigation was thrown away. Now a closed
 * layer's entry stays where it is, **spent**: the next layer opened on the same page takes it over
 * instead of pushing another, and a Back pressed with nothing open skips the spent entries and the
 * page's own in one go — one press leaves the page, as it should.
 */
export function createBackDismiss(win: BackDismissWindow) {
  const stack: { close: () => void }[] = [];
  let ownBacks = 0;
  let listening = false;
  /**
   * Entries left by closed layers on top of each page's own, by page.
   *
   * ⚠️⚠️ Per page, not one page at a time. Kept for the last page only, a layer closed on a second
   * page forgot the entries left on the first, and coming back to it took a Back that did nothing.
   */
  const spent = new Map<string, number>();
  /** Where the history stood before the latest move: what a popstate came from. */
  let here = win.location.href;

  const onPop = () => {
    const from = here;
    here = win.location.href;
    // The skip this module made.
    if (ownBacks > 0) {
      ownBacks -= 1;
      return;
    }
    // Back with something open: the innermost layer closes, and only it.
    const top = stack.pop();
    if (top) {
      top.close();
      return;
    }
    // Back with nothing open, pressed ON a page with spent entries: past them and past the page's
    // own entry, so the press does what it says instead of landing on the same page.
    // Coming back to the page from another one lands on its newest spent entry, which shows the
    // page: that is the arrival, and nothing is skipped.
    const steps = spent.get(here) ?? 0;
    if (steps > 0 && from === here) {
      spent.delete(here);
      ownBacks += 1;
      win.history.go(-steps);
    }
  };

  return {
    /** Opens a layer. Returns what to call when it closes. */
    open(close: () => void): () => void {
      if (!listening) {
        win.addEventListener("popstate", onPop);
        listening = true;
      }
      const href = win.location.href;
      here = href;
      const left = spent.get(href) ?? 0;
      if (left > 0) {
        // An entry a closed layer left on this page: this layer takes it over.
        spent.set(href, left - 1);
      } else {
        // The page's own state, copied: Next reads it on Back and must find the page it left.
        win.history.pushState(win.history.state, "");
      }
      const layer = { close };
      stack.push(layer);

      return () => {
        const index = stack.indexOf(layer);
        // Gone already: Back closed it, and its entry went with that Back.
        if (index === -1) return;
        stack.splice(index, 1);
        // Closed by its button, a choice made in it, or a link followed from it: the entry stays,
        // spent, on the page the layer was opened on.
        spent.set(href, (spent.get(href) ?? 0) + 1);
      };
    },

    /** The history moved without a popstate: a link, router.push, a redirect. */
    moved() {
      here = win.location.href;
    },

    /** A link is followed to this page anew: what was left on it before is history, not spent. */
    arriving(href: string) {
      spent.delete(href);
    },
  };
}

let shared: ReturnType<typeof createBackDismiss> | null = null;

function sharedBackDismiss() {
  if (!shared) {
    const instance = createBackDismiss(window);
    shared = instance;
    // ⚠️ Every move the router makes, so a later Back knows which page it left: a popstate alone
    // says where the history went, not where it came from. Wrapped, not replaced — Next patches
    // these two as well, and both patches run.
    for (const method of ["pushState", "replaceState"] as const) {
      const original = window.history[method];
      window.history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        instance.moved();
        return result;
      };
    }
    document.addEventListener(
      "click",
      (event) => {
        const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (link) instance.arriving(new URL(link.href, window.location.href).href);
      },
      true,
    );
  }
  return shared;
}

/**
 * The layers open now, innermost last, where the browser has CloseWatcher (Chrome on Android, the
 * installed app included). One BackController (src/components/back-controller.tsx) holds the only
 * watcher and, on Back, closes the top layer — or, with none open, goes up a level.
 *
 * ⚠️⚠️ **One watcher for the whole app, never one per layer.** Chrome groups the watchers a page
 * makes without a fresh tap and closes a whole group on one Back; one per dialog was closed in
 * bunches, or not at all. And with no layer open Back walked the history, which is the order
 * things were tapped, not the way up: see src/lib/back-plan.ts.
 */
export function createLayerStack() {
  const layers: { close: () => void }[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    get count() {
      return layers.length;
    },
    /** Adds a layer; returns what removes it when it closes by itself (its X, a choice, a link). */
    add(close: () => void): () => void {
      const layer = { close };
      layers.push(layer);
      changed();
      return () => {
        const index = layers.indexOf(layer);
        if (index === -1) return;
        layers.splice(index, 1);
        changed();
      };
    },
    /** Back: the innermost layer, and only it. Taken off at once, so a second Back reaches the next. */
    closeTop() {
      const top = layers.pop();
      if (!top) return;
      changed();
      top.close();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const backLayers = createLayerStack();

/** Whether Back is the BackController's here: a phone, with CloseWatcher. */
export function backIsControlled(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE).matches && "CloseWatcher" in window;
}

/**
 * On a phone, the system's Back button closes what is open on top of the page — a full-screen
 * dialog, an edit form, a confirmation, the notifications, the recents, a sheet, the Menu hub, an
 * open chat conversation — instead of leaving the page under it. That is what Back does in every
 * app, and an installed PWA has no other.
 *
 * Mounted with the layer's content (which exists only while it is open). Layers nest: Back closes
 * the template list and leaves the email dialog under it open.
 *
 * With CloseWatcher the layer joins `backLayers`; without it (Safari, Firefox) it falls back to the
 * history entries above. Desktop is left alone: there Back is a page's, and Escape and the overlay
 * close a dialog.
 */
export function useBackDismiss(close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia(PHONE).matches) return;
    if (backIsControlled()) return backLayers.add(() => closeRef.current());
    return sharedBackDismiss().open(() => closeRef.current());
  }, []);
}

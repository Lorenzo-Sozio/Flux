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
  /** Entries left by closed layers on top of this page's own, and the page they belong to. */
  let spent = 0;
  let spentHref: string | null = null;

  const onPop = () => {
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
    // Back with nothing open, landing on this page's spent entries: past them and past the page's
    // own entry, so the press does what it says instead of landing on the same page.
    if (spent > 0 && win.location.href === spentHref) {
      const steps = spent;
      spent = 0;
      spentHref = null;
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
      if (spent > 0 && spentHref === href) {
        // An entry a closed layer left on this page: this layer takes it over.
        spent -= 1;
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
        if (spentHref !== href) {
          spentHref = href;
          spent = 0;
        }
        spent += 1;
      };
    },

    /** A link is followed to this page anew: what was left on it before is history, not spent. */
    arriving(href: string) {
      if (href === spentHref) {
        spent = 0;
        spentHref = null;
      }
    },
  };
}

let shared: ReturnType<typeof createBackDismiss> | null = null;

function sharedBackDismiss() {
  if (!shared) {
    const instance = createBackDismiss(window);
    shared = instance;
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
 * On a phone, the system's Back button closes what is open on top of the page — a full-screen
 * dialog, an edit form, a confirmation, the notifications, the recents, a sheet, the Menu hub —
 * instead of leaving the page under it. That is what Back does in every app, and an installed PWA
 * has no other.
 *
 * Mounted with the layer's content (which exists only while it is open). Layers nest: Back closes
 * the template list and leaves the email dialog under it open.
 *
 * Desktop is left alone: there Back is a page's, and Escape and the overlay close a dialog.
 */
export function useBackDismiss(close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia(PHONE).matches) return;
    return sharedBackDismiss().open(() => closeRef.current());
  }, []);
}

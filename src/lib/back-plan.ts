/**
 * What the phone's Back button does in Flux: an app's Back, not a browser's.
 *
 * 1. Something is open on top of the page — a dialog, a sheet, a panel, a chat conversation: it
 *    closes. (The X.)
 * 2. Otherwise the page's own back arrow (the top bar's, src/navigation/back-target.ts): a record
 *    goes back to its list, a sub-page to its section.
 * 3. Otherwise, anywhere but the home: the home.
 * 4. On the home: the system's Back, which leaves the app.
 *
 * ⚠️⚠️ Why not the history. Back used to walk the browser history, which is the order things were
 * tapped: from a contact it went to whichever section the bottom bar had shown before, and when the
 * history ran out on a page other than the home it closed the app. The user's question at every
 * Back is "up one level", and the history does not know the levels.
 *
 * Going up still uses the history where it can: when the page above is right behind in it, Back is
 * a real history step (`go`), so nothing piles up and the home ends at the bottom — where the
 * system's Back closes the app, as it should. Otherwise the page is *replaced* by the one above.
 */

export type BackStep =
  | { kind: "close" }
  /** A history step back to the page above, already in the history. */
  | { kind: "go"; delta: number; finish?: "home" }
  /** The page above, in place of this one. */
  | { kind: "replace"; to: string }
  /** The system's Back: the app closes. */
  | { kind: "system" };

export interface BackState {
  /** Layers open on top of the page. */
  layers: number;
  pathname: string;
  /** The history since the app opened, as pathnames, and where it stands now. */
  entries: readonly string[];
  index: number;
  home: string;
  /** The page above this one, or null when it has none (a section of the menu). */
  above: (pathname: string) => string | null;
}

export function planBack(s: BackState): BackStep {
  if (s.layers > 0) return { kind: "close" };
  if (s.pathname === s.home) {
    // The home with history below it: down to the bottom, so the next Back leaves the app instead
    // of wandering through what was tapped before. Whatever opened the app is then replaced by the
    // home, if it was not the home.
    return s.index > 0 ? { kind: "go", delta: -s.index, finish: "home" } : { kind: "system" };
  }
  const target = s.above(s.pathname) ?? s.home;
  for (let j = s.index - 1; j >= 0; j--) {
    if (s.entries[j] === target) return { kind: "go", delta: j - s.index };
  }
  return { kind: "replace", to: target };
}

/** Whether Back has to be caught at all, or is the system's (the home, nothing open). */
export function catchesBack(s: BackState): boolean {
  return planBack(s).kind !== "system";
}

/**
 * The history since the app opened, kept beside the browser's, which does not say what is behind
 * the current entry. Told of every push and replace; a popstate tells it where it landed.
 */
export function createHistoryMirror(initial: string) {
  let entries: string[] = [initial];
  let index = 0;
  return {
    get entries(): readonly string[] {
      return entries;
    },
    get index() {
      return index;
    },
    push(pathname: string) {
      entries = [...entries.slice(0, index + 1), pathname];
      index = entries.length - 1;
    },
    replace(pathname: string) {
      entries = entries.map((e, i) => (i === index ? pathname : e));
    },
    /** A step this module made with `history.go(delta)`. */
    went(delta: number) {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
    },
    /**
     * A popstate nobody here made (a page's own `router.back()`): the nearest entry behind with
     * that page, or — not found — a fresh start from where the history now stands.
     */
    landed(pathname: string) {
      if (entries[index] === pathname) return;
      for (let j = index - 1; j >= 0; j--) {
        if (entries[j] === pathname) {
          index = j;
          return;
        }
      }
      entries = [pathname];
      index = 0;
    },
  };
}

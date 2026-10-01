/**
 * Back closes what is open on top of the page, one layer at a time, and leaves the history as it
 * found it when a layer is closed some other way.
 */
import { describe, expect, it, vi } from "vitest";

import { attachBackDismiss, type BackDismissWindow } from "./use-back-dismiss";

/** A browser history in miniature: entries, a cursor, and popstate on Back. */
function fakeWindow() {
  const entries: unknown[] = [{ __next: "page" }];
  let index = 0;
  const listeners = new Set<(e: PopStateEvent) => void>();
  const timers: (() => void)[] = [];
  const win: BackDismissWindow = {
    history: {
      get state() {
        return entries[index];
      },
      pushState(state: unknown) {
        entries.splice(index + 1);
        entries.push(state);
        index += 1;
      },
      back() {
        if (index === 0) return;
        index -= 1;
        for (const l of [...listeners]) l({ state: entries[index] } as PopStateEvent);
      },
    } as BackDismissWindow["history"],
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    setTimeout: (h) => timers.push(h),
  };
  const flush = () => {
    while (timers.length) timers.shift()?.();
  };
  return { win, entries: () => entries.slice(0, index + 1), flush };
}

describe("⚠️⚠️ Back on a phone", () => {
  it("closes the open layer instead of leaving the page", () => {
    const { win, entries } = fakeWindow();
    const close = vi.fn();
    attachBackDismiss(win, close, "a");
    expect(entries()).toHaveLength(2);
    win.history.back();
    expect(close).toHaveBeenCalledTimes(1);
    expect(entries()).toEqual([{ __next: "page" }]);
  });

  it("closes only the top layer of two: the dialog under the list stays open", () => {
    const { win } = fakeWindow();
    const closeDialog = vi.fn();
    const closeList = vi.fn();
    attachBackDismiss(win, closeDialog, "dialog");
    attachBackDismiss(win, closeList, "list");
    win.history.back();
    expect(closeList).toHaveBeenCalledTimes(1);
    expect(closeDialog).not.toHaveBeenCalled();
    win.history.back();
    expect(closeDialog).toHaveBeenCalledTimes(1);
  });

  it("closed by its own button, it takes its entry back off, and nothing else closes", () => {
    const { win, entries, flush } = fakeWindow();
    const closeDialog = vi.fn();
    attachBackDismiss(win, closeDialog, "dialog");
    const detachList = attachBackDismiss(win, vi.fn(), "list");
    detachList();
    flush();
    expect(entries()).toHaveLength(2);
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it("a layer closed by Back does not take a second entry off", () => {
    const { win, entries, flush } = fakeWindow();
    const detach = attachBackDismiss(win, vi.fn(), "a");
    win.history.back();
    detach();
    flush();
    expect(entries()).toEqual([{ __next: "page" }]);
  });

  it("a layer closed by navigating away leaves the new page's entry alone", () => {
    const { win, entries, flush } = fakeWindow();
    const detach = attachBackDismiss(win, vi.fn(), "a");
    win.history.pushState({ __next: "record" }, "");
    detach();
    flush();
    expect(entries().at(-1)).toEqual({ __next: "record" });
  });

  it("keeps the page's own state in the entry it pushes", () => {
    const { win } = fakeWindow();
    attachBackDismiss(win, vi.fn(), "a");
    expect(win.history.state).toEqual({ __next: "page", fluxLayers: ["a"] });
  });
});

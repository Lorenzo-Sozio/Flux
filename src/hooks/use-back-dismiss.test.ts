/**
 * Back closes what is open on top of the page, one layer at a time; closing a layer never moves the
 * history (a Back would discard the refresh a save starts, or the navigation a link starts); and
 * one Back with nothing open leaves the page, however many layers came and went on it.
 */
import { describe, expect, it, vi } from "vitest";

import { type BackDismissWindow, createBackDismiss, createLayerStack } from "./use-back-dismiss";

/** A browser history in miniature: entries, a cursor, a URL, and popstate on Back. */
function fakeWindow() {
  const entries: { state: unknown; href: string }[] = [
    { state: { __NA: true }, href: "/dashboard/leads" },
    { state: { __NA: true }, href: "/dashboard/contacts/c1" },
  ];
  let index = 1;
  const listeners: (() => void)[] = [];
  const go = vi.fn((delta: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, index + delta));
    if (next === index) return;
    index = next;
    for (const l of listeners) l();
  });
  const win: BackDismissWindow = {
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(state: unknown) {
        entries.splice(index + 1);
        entries.push({ state, href: entries[index].href });
        index += 1;
      },
      go,
    } as unknown as BackDismissWindow["history"],
    location: {
      get href() {
        return entries[index].href;
      },
    },
    addEventListener: (_t, l) => listeners.push(l),
  };
  return {
    win,
    go,
    /** The system's Back button. */
    back: () => win.history.go(-1),
    depth: () => index + 1,
    href: () => entries[index].href,
    /** Next's router rewriting the current entry, as it does on every refresh. */
    nextRewrites: () => {
      entries[index].state = { __NA: true, tree: "new" };
    },
    /** A navigation to another page, as router.push makes. */
    navigate: (href: string) => {
      entries.splice(index + 1);
      entries.push({ state: { __NA: true }, href });
      index += 1;
    },
  };
}

describe("⚠️⚠️ Back on a phone", () => {
  it("closes the open layer instead of leaving the page", () => {
    const h = fakeWindow();
    const close = vi.fn();
    createBackDismiss(h.win).open(close);
    expect(h.depth()).toBe(3);
    h.back();
    expect(close).toHaveBeenCalledTimes(1);
    expect(h.href()).toBe("/dashboard/contacts/c1");
  });

  it("closes only the top layer of two: the dialog under the list stays open", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    const closeDialog = vi.fn();
    const closeList = vi.fn();
    back.open(closeDialog);
    back.open(closeList);
    h.back();
    expect(closeList).toHaveBeenCalledTimes(1);
    expect(closeDialog).not.toHaveBeenCalled();
    h.back();
    expect(closeDialog).toHaveBeenCalledTimes(1);
  });

  it("⚠️⚠️ closing a layer — a save, its X — never moves the history: a refresh or a navigation in flight survives", () => {
    const h = fakeWindow();
    const detach = createBackDismiss(h.win).open(vi.fn());
    detach();
    expect(h.go).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ after an edit form is saved and closed, one Back leaves the page", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    back.open(vi.fn())();
    h.nextRewrites();
    h.back();
    expect(h.href()).toBe("/dashboard/leads");
  });

  it("⚠️⚠️ keeps working however many times, with Next rewriting the entries in between", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    for (let i = 0; i < 5; i++) {
      // Opened, the page refreshed, closed by its own button.
      back.open(vi.fn())();
      h.nextRewrites();
      // Opened again — on the entry the last one left — the page refreshed, closed by Back.
      const close = vi.fn();
      back.open(close);
      h.nextRewrites();
      h.back();
      expect(close).toHaveBeenCalledTimes(1);
      expect(h.href()).toBe("/dashboard/contacts/c1");
    }
    // No entries piled up.
    expect(h.depth()).toBe(2);
  });

  it("⚠️ two dialogs one over the other, both closed by their X: one Back still leaves the page", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    const closeOuter = back.open(vi.fn());
    const closeInner = back.open(vi.fn());
    closeInner();
    closeOuter();
    h.back();
    expect(h.href()).toBe("/dashboard/leads");
  });

  it("a layer opened on the entry a closed one left takes it over, instead of pushing another", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    back.open(vi.fn())();
    const depth = h.depth();
    back.open(vi.fn());
    expect(h.depth()).toBe(depth);
  });

  it("a layer left by a link: one Back from the new page returns to the page", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    const detach = back.open(vi.fn());
    h.navigate("/dashboard/leads/l9");
    detach();
    h.back();
    expect(h.href()).toBe("/dashboard/contacts/c1");
  });

  it("⚠️⚠️ layers closed on two pages: coming back through both, no Back does nothing", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    // A dialog on the contact, closed by its X; then on to a deal, another dialog closed there.
    back.open(vi.fn())();
    h.navigate("/dashboard/pipeline/d1");
    back.moved();
    back.open(vi.fn())();
    h.back();
    expect(h.href()).toBe("/dashboard/contacts/c1");
    h.back();
    expect(h.href()).toBe("/dashboard/leads");
  });

  it("⚠️ coming back to a page from another one shows the page, and skips nothing", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    back.open(vi.fn())();
    h.navigate("/dashboard/chat");
    back.moved();
    h.back();
    expect(h.href()).toBe("/dashboard/contacts/c1");
    // Landed on the entry the closed layer left: no second move on top of the Back.
    expect(h.depth()).toBe(3);
    h.back();
    expect(h.href()).toBe("/dashboard/leads");
  });

  it("a page reached anew by a link forgets what was left on it before", () => {
    const h = fakeWindow();
    const back = createBackDismiss(h.win);
    back.open(vi.fn())();
    back.arriving("/dashboard/contacts/c1");
    h.back();
    // An ordinary Back, not a skip.
    expect(h.go).toHaveBeenCalledTimes(1);
  });

  it("keeps the page's own state in the entry it pushes, so Next finds the page on Back", () => {
    const h = fakeWindow();
    createBackDismiss(h.win).open(vi.fn());
    expect(h.win.history.state).toEqual({ __NA: true });
  });
});

describe("⚠️⚠️ the layers Back closes, where the browser has CloseWatcher", () => {
  it("Back closes the top layer, and only it; a second Back the next one", () => {
    const stack = createLayerStack();
    const closeDialog = vi.fn();
    const closeList = vi.fn();
    stack.add(closeDialog);
    stack.add(closeList);
    stack.closeTop();
    expect(closeList).toHaveBeenCalledTimes(1);
    expect(closeDialog).not.toHaveBeenCalled();
    stack.closeTop();
    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(stack.count).toBe(0);
  });

  it("a layer closed by its own X leaves the stack, and tells whoever listens", () => {
    const stack = createLayerStack();
    const heard = vi.fn();
    stack.subscribe(heard);
    const remove = stack.add(vi.fn());
    remove();
    expect(stack.count).toBe(0);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe("⚠️⚠️ only an open dialog is a layer", () => {
  it("the primitives register through <BackDismiss> inside the Content, never in the wrapper", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["dialog", "sheet", "alert-dialog", "drawer"]) {
      const src = readFileSync(`src/components/ui/${file}.tsx`, "utf8");
      // The wrapper (DialogContent, SheetContent…) is mounted whenever the dialog is in the tree,
      // open or not: a hook there made every closed dialog an open layer.
      expect(src, file).not.toMatch(/\buseBackDismiss\(/);
      expect(src, file).toMatch(/<BackDismiss onBack=/);
    }
  });
});

/**
 * The phone's Back is an app's: close what is open, else up a level, else home, and only on the
 * home the system's — never the order things were tapped in.
 */
import { describe, expect, it } from "vitest";

import { backTargetOf, HOME_PATH } from "@/navigation/back-target";

import { type BackState, catchesBack, createHistoryMirror, planBack } from "./back-plan";

const state = (over: Partial<BackState>): BackState => ({
  layers: 0,
  pathname: "/dashboard/contacts",
  entries: ["/dashboard/crm", "/dashboard/contacts"],
  index: 1,
  home: HOME_PATH,
  above: backTargetOf,
  ...over,
});

describe("⚠️⚠️ what Back does", () => {
  it("closes what is open first, whatever the page", () => {
    expect(planBack(state({ layers: 2, pathname: HOME_PATH, index: 0 }))).toEqual({ kind: "close" });
  });

  it("from a record, back to its list — through the history when the list is right behind", () => {
    const s = state({
      pathname: "/dashboard/contacts/c1",
      entries: ["/dashboard/crm", "/dashboard/contacts", "/dashboard/contacts/c1"],
      index: 2,
    });
    expect(planBack(s)).toEqual({ kind: "go", delta: -1 });
  });

  it("⚠️⚠️ from a record reached from elsewhere, to its list — not to the page tapped before", () => {
    const s = state({
      pathname: "/dashboard/contacts/c1",
      entries: ["/dashboard/crm", "/dashboard/calendar", "/dashboard/contacts/c1"],
      index: 2,
    });
    expect(planBack(s)).toEqual({ kind: "replace", to: "/dashboard/contacts" });
  });

  it("from a section of the menu, home — through the history when the home is behind", () => {
    const s = state({
      pathname: "/dashboard/chat",
      entries: ["/dashboard/crm", "/dashboard/leads", "/dashboard/chat"],
      index: 2,
    });
    expect(planBack(s)).toEqual({ kind: "go", delta: -2 });
  });

  it("⚠️⚠️ from a section the app opened on, the home — never out of the app", () => {
    const s = state({ pathname: "/dashboard/chat", entries: ["/dashboard/chat"], index: 0 });
    expect(planBack(s)).toEqual({ kind: "replace", to: HOME_PATH });
    expect(catchesBack(s)).toBe(true);
  });

  it("a sub-page goes to its section (Pipeline › Forecast)", () => {
    const s = state({ pathname: "/dashboard/pipeline/forecast", entries: ["/dashboard/pipeline/forecast"], index: 0 });
    expect(planBack(s)).toEqual({ kind: "replace", to: "/dashboard/pipeline" });
  });

  it("on the home at the start of the history, the system's Back: the app closes", () => {
    const s = state({ pathname: HOME_PATH, entries: [HOME_PATH], index: 0 });
    expect(planBack(s)).toEqual({ kind: "system" });
    expect(catchesBack(s)).toBe(false);
  });

  it("⚠️ on the home with history below it, down to the start, so the next Back leaves", () => {
    const s = state({ pathname: HOME_PATH, entries: ["/dashboard/chat", "/dashboard/leads", HOME_PATH], index: 2 });
    expect(planBack(s)).toEqual({ kind: "go", delta: -2, finish: "home" });
  });
});

describe("the history mirror", () => {
  it("pushes cut what was ahead; replaces change the current entry", () => {
    const m = createHistoryMirror("/a");
    m.push("/b");
    m.push("/c");
    m.went(-2);
    m.push("/d");
    expect(m.entries).toEqual(["/a", "/d"]);
    m.replace("/e");
    expect(m.entries).toEqual(["/a", "/e"]);
    expect(m.index).toBe(1);
  });

  it("a popstate it did not make lands on the nearest entry behind with that page, else starts afresh", () => {
    const m = createHistoryMirror("/a");
    m.push("/b");
    m.push("/c");
    m.landed("/a");
    expect(m.index).toBe(0);
    m.landed("/z");
    expect(m.entries).toEqual(["/z"]);
    expect(m.index).toBe(0);
  });
});

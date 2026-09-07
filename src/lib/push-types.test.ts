/**
 * What is allowed to wake a phone.
 *
 * Two failures matter here and neither one is visible from the inside. Pushing
 * something a person switched off costs their trust, and once they turn the
 * whole feature off the SLA breach at 3am does not reach them either. Not
 * pushing something they left on is worse and quieter: nothing appears, nothing
 * is logged, and the notification is still sitting correctly in the bell.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  isPushType,
  PUSH_TYPE_ORDER,
  PUSH_TYPES,
  parseOverrides,
  resolveAll,
  serialiseOverrides,
  shouldPush,
} from "./push-types";

describe("the catalogue", () => {
  it("⚠️ wakes a phone only for the things that need a person now", () => {
    // Pinned deliberately. Turning any of these on by default is a product
    // decision about somebody's evening, not a detail — a default of "everything"
    // is how a person ends up switching the feature off entirely.
    const onByDefault = PUSH_TYPE_ORDER.filter((t) => PUSH_TYPES[t].defaultOn);
    expect(onByDefault).toEqual(["lead_assigned", "sla_breach", "sla_warning", "task_due"]);
  });

  it("keeps the chatty ones off until somebody asks for them", () => {
    expect(PUSH_TYPES.chat_message.defaultOn).toBe(false);
    expect(PUSH_TYPES.note.defaultOn).toBe(false);
  });

  it("lists what is on by default first", () => {
    const firstOff = PUSH_TYPE_ORDER.findIndex((t) => !PUSH_TYPES[t].defaultOn);
    const lastOn = PUSH_TYPE_ORDER.map((t) => PUSH_TYPES[t].defaultOn).lastIndexOf(true);
    expect(lastOn).toBeLessThan(firstOff);
  });
});

describe("deciding whether to send", () => {
  it("sends what the defaults allow when nobody has chosen anything", () => {
    expect(shouldPush("lead_assigned", DEFAULT_PREFERENCES)).toBe(true);
    expect(shouldPush("chat_message", DEFAULT_PREFERENCES)).toBe(false);
  });

  it("⚠️ obeys the master switch over every individual choice", () => {
    // Somebody who turns everything off has turned everything off. A type left
    // switched on underneath is not consent.
    const prefs = { enabled: false, overrides: { lead_assigned: true, sla_breach: true } } as const;
    expect(shouldPush("lead_assigned", prefs)).toBe(false);
    expect(shouldPush("sla_breach", prefs)).toBe(false);
  });

  it("lets a choice beat the default in both directions", () => {
    expect(shouldPush("chat_message", { enabled: true, overrides: { chat_message: true } })).toBe(true);
    expect(shouldPush("task_due", { enabled: true, overrides: { task_due: false } })).toBe(false);
  });

  it("⚠️ refuses a type nobody catalogued", () => {
    // A thirteenth notification type added to the product without being added
    // here must not push. The notification still reaches the bell; what does not
    // happen is a phone buzzing for something no one decided should buzz.
    expect(shouldPush("invoice_overdue", DEFAULT_PREFERENCES)).toBe(false);
    expect(shouldPush("", DEFAULT_PREFERENCES)).toBe(false);
  });
});

describe("what gets stored", () => {
  it("⚠️ holds only the choices actually made", () => {
    // This is why it is an override map and not a list of enabled types. A
    // stored list freezes the defaults on the day it was saved, so a type added
    // later arrives switched off for everyone who ever opened the settings
    // screen — silently, and looking exactly like a bug in the sender.
    expect(serialiseOverrides({ chat_message: true })).toBe('{"chat_message":true}');
    expect(parseOverrides('{"chat_message":true}')).toEqual({ chat_message: true });
  });

  it("leaves an untouched type on whatever the catalogue currently says", () => {
    const stored = parseOverrides(serialiseOverrides({ chat_message: true }));
    expect(resolveAll({ enabled: true, overrides: stored }).lead_assigned).toBe(PUSH_TYPES.lead_assigned.defaultOn);
  });

  it("⚠️ survives a column holding something it should not", () => {
    // Written by us, read by us — but it is text holding JSON, and a half-written
    // value must not take every notification in the workspace down with it.
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("")).toEqual({});
    expect(parseOverrides("not json")).toEqual({});
    expect(parseOverrides("[1,2,3]")).toEqual({});
    expect(parseOverrides('"a string"')).toEqual({});
    expect(parseOverrides("null")).toEqual({});
  });

  it("drops keys and values it does not recognise", () => {
    expect(parseOverrides('{"lead_assigned":false,"made_up":true,"task_due":"yes"}')).toEqual({
      lead_assigned: false,
    });
    expect(serialiseOverrides({ made_up: true, task_due: false } as never)).toBe('{"task_due":false}');
  });
});

describe("the settings screen's view", () => {
  it("has an answer for every type, chosen or not", () => {
    const resolved = resolveAll({ enabled: true, overrides: { chat_message: true } });
    expect(Object.keys(resolved).sort()).toEqual([...PUSH_TYPE_ORDER].sort());
    expect(resolved.chat_message).toBe(true);
  });

  it("recognises exactly the catalogue", () => {
    expect(isPushType("task_due")).toBe(true);
    expect(isPushType("toString")).toBe(false);
  });
});

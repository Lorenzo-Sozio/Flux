/**
 * The event catalogue (src/lib/webhook-events.ts) against the code that sends events and
 * the screen that subscribes to them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_EVENTS, cleanSubscription, WEBHOOK_EVENTS } from "./webhook-events";

const read = (p: string) => readFileSync(p, "utf8");
function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const code = sources().map((f) => ({ f: f.split("\\").join("/"), src: read(f) }));

describe("⚠️⚠️ the event catalogue", () => {
  it("every event it offers is sent from somewhere — a box nobody fills is a subscription that never fires", () => {
    const emitted = code.map((c) => c.src).join("\n");
    const orderStatuses =
      read("src/lib/order-status.ts")
        .match(/"(\w+)"/g)
        ?.map((s) => s.slice(1, -1)) ?? [];
    const silent = WEBHOOK_EVENTS.map((e) => e.name).filter((name) => {
      if (emitted.includes(`"${name}"`)) return false;
      // order.<status> is sent as a template over the order's status.
      if (name.startsWith("order.") && emitted.includes("`order.${status}`")) {
        return !orderStatuses.includes(name.slice("order.".length));
      }
      return true;
    });
    expect(silent).toEqual([]);
  });

  it('⚠️⚠️ no server action can send an event: the dispatcher is out of every "use server" file', () => {
    const leaking = code
      .filter((c) => /^["']use server["'];?/m.test(c.src.slice(0, 200)))
      .filter((c) => /export async function (dispatchWebhook|dispatchRuleEvent|deliver)\b/.test(c.src))
      .map((c) => c.f);
    expect(leaking).toEqual([]);
  });

  it("the settings screen offers the catalogue, not a list of its own", () => {
    const screen = read("src/app/(main)/dashboard/settings/webhooks/_components/webhooks-client.tsx");
    expect(screen).toContain("...WEBHOOK_EVENTS.map(");
    expect(screen).not.toMatch(/value: "contact\.created"/);
  });

  it("⚠️ a subscription keeps catalogue events, rule events and everything — and nothing that is not a name", () => {
    // A rule may name its own event under any prefix (`lead.qualified`), so a dotted name
    // outside the catalogue is kept: refusing it would drop subscriptions to rules that
    // exist. What cannot be an event name at all is dropped.
    expect(
      cleanSubscription(["contact.created", "Contact.Created", "deal.won", "*", "vip.escalated", "noDot", "a.b c"]),
    ).toEqual(["contact.created", "deal.won", ALL_EVENTS, "vip.escalated"]);
    expect(cleanSubscription("contact.created")).toEqual([]);
  });
});

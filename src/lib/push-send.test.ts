/**
 * ⚠️⚠️ A push is written in its recipient's language.
 *
 * What a notification row stores is English — two jobs recognise a reminder already sent by
 * that text — and it was exactly what every push carried: an Italian office's phones rang
 * in English while the bell beside them spoke Italian. The push composes a keyed row again
 * in the language the person reads the product in.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent: { endpoint: string; payload: { title: string; body?: string } }[] = [];
vi.mock("@/lib/web-push", () => ({
  sendPush: async (device: { endpoint: string }, payload: string) => {
    sent.push({ endpoint: device.endpoint, payload: JSON.parse(payload) });
    return { status: "sent" };
  },
}));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void fn() }));

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { notificationPreferences, pushSubscriptions, users } from "@/db/schema";

import { composeNotification } from "./notification-text";
import { deliver } from "./push-send";

const pg = drizzle(new PGlite());
const KEYS = { publicKey: "p", privateKey: "k", subject: "mailto:x@example.com" };

beforeAll(async () => {
  await applyTenantMigrations(pg as never);
  await pg.insert(users).values([
    { id: "anna", email: "anna@example.com", name: "Anna" },
    { id: "bob", email: "bob@example.com", name: "Bob" },
    { id: "carla", email: "carla@example.com", name: "Carla" },
  ]);
  await pg.insert(notificationPreferences).values([
    { userId: "anna", locale: "it" },
    { userId: "bob", locale: "en" },
  ]);
  await pg.insert(pushSubscriptions).values(
    ["anna", "bob", "carla"].map((u) => ({
      userId: u,
      endpoint: `https://push.example/${u}`,
      p256dh: "x",
      auth: "y",
    })),
  );
});

beforeEach(() => {
  sent.length = 0;
});

async function keyedRow(userId: string) {
  const params = { title: "Ordinare i lauri" };
  const text = await composeNotification("taskDueToday", params);
  return { userId, type: "task_due", ...text, titleKey: "taskDueToday", params, link: "/dashboard/tasks" };
}

const to = (user: string) => sent.find((s) => s.endpoint.endsWith(`/${user}`))?.payload;

describe("⚠️⚠️ a push is written in its recipient's language", () => {
  it("in Italian for somebody who reads the product in Italian", async () => {
    await deliver(pg as never, [await keyedRow("anna")], KEYS as never);
    expect(to("anna")?.title).toBe("Scade oggi: «Ordinare i lauri»");
    expect(to("anna")?.body).toBe("Questa attività scade oggi.");
  });

  it("as stored for somebody who reads it in English, or has never said", async () => {
    await deliver(pg as never, [await keyedRow("bob"), await keyedRow("carla")], KEYS as never);
    expect(to("bob")?.title).toBe("Task due today: “Ordinare i lauri”");
    expect(to("carla")?.title).toBe("Task due today: “Ordinare i lauri”");
  });

  it("leaves text a person wrote exactly as they wrote it", async () => {
    await deliver(
      pg as never,
      [{ userId: "anna", type: "task_due", title: "Richiamare il cliente", message: "Scritto da una regola" }],
      KEYS as never,
    );
    expect(to("anna")).toMatchObject({ title: "Richiamare il cliente", body: "Scritto da una regola" });
  });
});

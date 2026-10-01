/**
 * Notifications the product writes are composed from keys, in both languages.
 *
 * ⚠️⚠️ They were finished English sentences inside the code — "Task due today", "SLA missed",
 * "Upcoming appointment" — shown to people who read Italian, and invisible to the
 * translation check because they live in the database. The bell now composes each one in
 * the reader's language from the key and values the row keeps.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import itMessages from "../../messages/it.json";
import { composeNotification, type NotificationKey } from "./notification-text";

/** Values that exercise every branch the messages use. */
const SAMPLE: Record<string, string | number> = {
  completer: "Anna",
  title: "Preventivo Rossi",
  description: "Richiamare",
  kind: "call",
  time: "10:30",
  count: 2,
  name: "Mario Rossi",
  number: "P-2026-001",
  hasReason: "yes",
  reason: "Sconto alto",
  sender: "Luca",
  preview: "Ciao",
  conversation: "Vendite",
  total: "€ 1.220,00",
  lines: 3,
  ticket: "TKT-1",
  subject: "Stampante",
  percent: "80%",
  unit: "hour",
  autoRenew: "yes",
  renewsOn: "2027-01-01",
  end: "2026-12-31",
  deadline: "2026-11-01",
  email: "anna@x.it",
  sequence: "Benvenuto",
  who: "Mario Rossi",
  when: "29/09/2026, 10:00",
  rules: 3,
  group: "Nord",
};

const KEYS = Object.keys(en.notificationTexts) as NotificationKey[];

describe("⚠️⚠️ every notification the product writes", () => {
  for (const [lang, messages] of [
    ["en", en],
    ["it", itMessages],
  ] as const) {
    it(`composes in ${lang}, with every value filled in`, () => {
      const t = createTranslator({ locale: lang, messages, namespace: "notificationTexts" } as never) as unknown as (
        k: string,
        v: Record<string, string | number>,
      ) => string;
      for (const key of KEYS) {
        for (const part of ["title", "message"]) {
          const text = t(`${key}.${part}`, SAMPLE);
          expect(text, `${lang} ${key}.${part}`).not.toMatch(/[{}]/);
          expect(text, `${lang} ${key}.${part}`).not.toBe(`notificationTexts.${key}.${part}`);
        }
      }
    });
  }

  it("is composed the same way every time — two jobs recognise a sent reminder by its title", async () => {
    const a = await composeNotification("taskDueToday", { title: "Chiamare Rossi" });
    const b = await composeNotification("taskDueToday", { title: "Chiamare Rossi" });
    expect(a).toEqual(b);
    expect(a.title).toBe("Task due today: “Chiamare Rossi”");
  });
});

describe("⚠️⚠️ notify", () => {
  it("stores the key and values with the composed text", async () => {
    const written: Record<string, unknown>[] = [];
    vi.doMock("@/lib/tenant-context", () => ({
      getDb: async () => ({ insert: () => ({ values: async (v: Record<string, unknown>) => written.push(v) }) }),
    }));
    vi.doMock("@/lib/push-send", () => ({ announce: () => undefined }));
    vi.doMock("server-only", () => ({}));
    const { notify } = await import("./notify");

    await notify({ userId: "u1", type: "deal_won", key: "dealWon", params: { name: "Impianto" } });

    expect(written[0]).toMatchObject({
      userId: "u1",
      type: "deal_won",
      titleKey: "dealWon",
      params: { name: "Impianto" },
      title: "Deal won! 🏆",
      message: "“Impianto” has been marked as won.",
    });
  });
});

describe("⚠️ no notification title is typed into the code any more", () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) files(full, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it("in any file that writes notifications", () => {
    const offenders: string[] = [];
    for (const full of files(join(process.cwd(), "src"))) {
      const file = relative(process.cwd(), full).split("\\").join("/");
      const src = readFileSync(full, "utf8");
      const writes = src.includes('from "@/lib/notify"') || /insert\(notifications\)/.test(src);
      if (!writes || file === "src/lib/notify.ts") continue;
      src.split("\n").forEach((line, i) => {
        if (/\btitle:\s*["'`]/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

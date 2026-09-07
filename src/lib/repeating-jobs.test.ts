/**
 * A job that repeats must remember what it already did.
 *
 * `task-reminders` did not. It runs every fifteen minutes, and for every task
 * due today it wrote a notification **and sent an email**, on every run: ninety-
 * six of each, per task, per person, per day. Nobody reported it, because the
 * bell only accumulates and a repeated reminder in an inbox reads as a reminder.
 * Wiring push notifications to the same rows is what would have made it
 * unmissable, in the worst way — a phone buzzing ninety-six times gets the
 * browser permission revoked and the whole feature switched off.
 *
 * The defect is structural and invisible in review: nothing about a `for` loop
 * that creates a notification says how often the loop runs. So the schedule and
 * the memory are checked together here, from the two files that actually decide
 * them.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

const WORKER = "custom-worker.ts";
const WRANGLER = "wrangler.jsonc";

/** Every schedule in custom-worker.ts, with the routes it fires. */
function scheduledJobs(): { schedule: string; route: string }[] {
  const block = read(WORKER).split("const CRON_JOBS")[1] ?? "";
  const out: { schedule: string; route: string }[] = [];
  for (const entry of block.matchAll(/"([^"]*\*[^"]*)":\s*\[([^\]]+)\]/g)) {
    for (const route of entry[2].matchAll(/"([^"]+)"/g)) {
      out.push({ schedule: entry[1], route: route[1] });
    }
  }
  return out;
}

/** True for anything that fires more than once a day. */
function repeatsWithinADay(schedule: string): boolean {
  const [minute, hour] = schedule.split(" ");
  return minute.includes("*") || hour.includes("*") || hour.includes(",");
}

/**
 * How each repeating job avoids telling somebody the same thing twice, and the
 * string in its source that proves it is still doing so.
 *
 * A new repeating job that notifies has to be added here. That is the point: the
 * question "what stops this repeating?" should be impossible to skip.
 */
const REMEMBERS: Record<string, { how: string; marker: string }> = {
  "/api/cron/task-reminders": {
    how: "reads back the notifications today has already produced, keyed by person and title",
    marker: "toldToday",
  },
  "/api/cron/ticket-sla-check": {
    how: "records the breach and the warning level on the ticket itself",
    marker: "slaWarnLevel",
  },
  "/api/cron/email-worker": {
    how: "the queue is the memory: a row is marked sent or failed as it is processed",
    marker: "processedAt",
  },
};

/** Jobs that repeat but tell nobody anything, so they have nothing to remember. */
const NOTIFIES_NOBODY = ["/api/cron/webhook-retry", "/api/cron/campaign-scheduler"];

function routeFile(route: string): string {
  return `src/app${route}/route.ts`;
}

describe("the cron schedules", () => {
  it("⚠️ are the same in custom-worker.ts and wrangler.jsonc", () => {
    // Cloudflare hands the handler the cron string it matched. A schedule in one
    // file and not the other is not an error anywhere: the trigger fires and the
    // worker finds no jobs for it, so the job simply never runs and nothing logs
    // the absence.
    const declared = new Set(
      [...(read(WRANGLER).match(/"crons":\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    );
    const handled = new Set(scheduledJobs().map((j) => j.schedule));

    expect([...handled].filter((s) => !declared.has(s))).toEqual([]);
    expect([...declared].filter((s) => !handled.has(s))).toEqual([]);
  });

  it("point at routes that exist", () => {
    const missing = scheduledJobs()
      .map((j) => j.route)
      .filter((route) => !existsSync(routeFile(route)));
    expect(missing).toEqual([]);
  });
});

describe("a job that repeats within a day", () => {
  const repeating = scheduledJobs().filter((j) => repeatsWithinADay(j.schedule));

  it("is a set somebody has thought about", () => {
    // If this is empty the parser broke, and every check below would pass by
    // examining nothing.
    expect(repeating.length).toBeGreaterThan(0);
  });

  it("⚠️ says how it avoids telling somebody the same thing twice", () => {
    const unaccounted = repeating
      .map((j) => j.route)
      .filter((route) => !REMEMBERS[route] && !NOTIFIES_NOBODY.includes(route));
    expect(unaccounted).toEqual([]);
  });

  it("⚠️ still does the thing it claims to do", () => {
    // The entry above is a claim about the code. This checks the code still
    // backs it, so deleting the mechanism cannot leave the note behind.
    const broken: string[] = [];
    for (const [route, { marker }] of Object.entries(REMEMBERS)) {
      const file = routeFile(route);
      if (!existsSync(file)) continue;
      if (!read(file).includes(marker)) broken.push(`${route} no longer contains ${marker}`);
    }
    expect(broken).toEqual([]);
  });

  it("⚠️ does not send an email it has already sent", () => {
    // task-reminders emailed on every run too, which is the half that costs
    // money and reaches people who never opened the app.
    const source = read(routeFile("/api/cron/task-reminders"));
    const guardAt = source.indexOf("toldToday.has(key)");
    // The call site, not the import line, which naturally comes first.
    const emailAt = source.indexOf("sendTaskDueEmail(user.email");
    expect(guardAt).toBeGreaterThan(-1);
    expect(emailAt).toBeGreaterThan(guardAt);
  });
});

describe("known gaps", () => {
  // ⚠️ Marked `it.fails`: it passes while the behaviour is still wrong and starts
  // failing the day somebody fixes it, which is exactly when this note is worth
  // reading.
  it.fails("the email worker remembers which activity reminders it has sent", () => {
    // `getActivitiesWithPendingReminder` asks for reminders due in the next two
    // minutes and the worker runs every minute, so each one matches on two
    // consecutive runs: two notifications and two emails where there should be
    // one. Twice is not ninety-six times, which is why this is a note and not a
    // fix, but it is the same shape of bug.
    //
    // Fixing it properly needs somewhere to record that a reminder went out —
    // a `reminder_sent_at` on the activity — which is a tenant migration, and a
    // migration is not something to slip into a bug fix.
    expect(read(routeFile("/api/cron/email-worker"))).toContain("reminderSentAt");
  });
});

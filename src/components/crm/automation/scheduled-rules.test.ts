/**
 * Scheduled automation rules are not offered while nothing runs them.
 *
 * ⚠️⚠️ The builder offered "daily at 08:00" and then said, in green, "Scheduled daily at
 * 08:00". The node-cron scheduler behind it read the rules once at boot with no workspace
 * active, never ran on Workers, and where it fired it sent `onCreate` for up to a thousand
 * records. A rule that looks scheduled and is not is worse than no option at all.
 *
 * When scheduled rules return — as a cron job over every workspace — this file is the one
 * to change, deliberately.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("⚠️⚠️ scheduled rules", () => {
  it("nothing starts a scheduler at boot", () => {
    expect(read("src/instrumentation.ts")).not.toMatch(/initializeScheduler|automation\/scheduler"/);
  });

  it("the builder can remove a schedule, and cannot write one", () => {
    const builder = read("src/components/crm/automation/rule-builder.tsx");
    expect(builder).toContain("trigger.scheduleUnavailable");
    expect(builder).not.toMatch(/`\$\{SCHEDULED_TRIGGER_PREFIX\}/);
    expect(builder).not.toMatch(/encodeScheduledTrigger\(/);
  });

  it("the list says a scheduled rule is not active", () => {
    const list = read("src/app/(main)/dashboard/automation/_components/automation-client.tsx");
    expect(list).toContain("triggers.scheduledInactive");
    expect(list).not.toContain('t("triggers.scheduled")');
  });
});

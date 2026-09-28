/**
 * ⚠️⚠️ The reminder email for a call or a meeting is written in the recipient's language and
 * dated on the workspace's clock.
 *
 * It was English for everybody, and its time was formatted in the server's zone — UTC on
 * Workers — so a call at ten in Rome was announced for eight.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { subject: string; html: string }[] = [];
vi.mock("@/lib/email-provider", () => ({
  sendEmail: async (m: { subject: string; html: string }) => {
    sent.push(m);
  },
  getPlatformEmailConfig: async () => null,
}));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => "https://flux.example" }));

import { sendActivityReminderEmail } from "./email";

// 10:00 in Rome on 28 September 2026 (summer time, UTC+2).
const AT = new Date("2026-09-28T08:00:00Z");

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = "test";
});

describe("⚠️⚠️ the activity reminder email", () => {
  it("is in Italian for somebody who reads the product in Italian, at Rome's ten o'clock", async () => {
    await sendActivityReminderEmail("anna@example.com", "call", "Richiamare Rossi", AT, "/dashboard/calendar", {
      locale: "it",
      timeZone: "Europe/Rome",
    });
    expect(sent[0].subject).toBe("Promemoria: chiamata oggi — Richiamare Rossi");
    expect(sent[0].html).toContain("Hai una chiamata in programma oggi.");
    expect(sent[0].html).toContain("Apri nel CRM");
    expect(sent[0].html).toContain("10:00");
    expect(sent[0].html).not.toContain("08:00");
  });

  it("is in English when the person reads it in English, or was never seen", async () => {
    await sendActivityReminderEmail("bob@example.com", "meeting", "Kick-off", AT, "/dashboard/calendar", {
      timeZone: "Europe/Rome",
    });
    expect(sent[0].subject).toBe("Reminder: meeting today — Kick-off");
    expect(sent[0].html).toContain("View in CRM");
  });
});

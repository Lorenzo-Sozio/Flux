/**
 * Follow-up sequences: when to send, when to stop, what can be saved.
 *
 * ⚠️ Every mistake here is an email a customer should not have received.
 */
import { describe, expect, it } from "vitest";

import { afterSending, cleanSequence, dueAt, MAX_STEPS, normaliseEmail, stopReasonFor } from "./sequence-plan";

const steps = [
  { delayDays: 0, subject: "Hello", body: "<p>Hi</p>" },
  { delayDays: 3, subject: "Following up", body: "<p>Any news?</p>" },
  { delayDays: 7, subject: "Last one", body: "<p>Closing the loop</p>" },
];
const now = new Date("2026-09-15T09:00:00Z");

describe("walking through the steps", () => {
  it("waits the next step's delay after a send", () => {
    expect(afterSending(0, steps, now)).toEqual({
      nextStep: 1,
      nextSendAt: new Date("2026-09-18T09:00:00Z"),
      status: "active",
    });
  });

  it("⚠️⚠️ completes after the last step instead of looking for one more", () => {
    expect(afterSending(2, steps, now)).toEqual({ nextStep: 3, nextSendAt: null, status: "completed" });
  });

  it("a one-step sequence completes on its only send", () => {
    expect(afterSending(0, [steps[0]], now).status).toBe("completed");
  });

  it("counts delays in whole days", () => {
    expect(dueAt(now, 0)).toEqual(now);
    expect(dueAt(now, 2).toISOString()).toBe("2026-09-17T09:00:00.000Z");
  });
});

describe("when to stop instead of sending", () => {
  const fine = { exists: true, email: "anna@example.com", enrolledEmail: "anna@example.com" };

  it("sends to someone with nothing against them", () => {
    expect(stopReasonFor(fine)).toBeNull();
  });

  it("⚠️⚠️ stops for an address that unsubscribed, from anything", () => {
    expect(stopReasonFor({ ...fine, suppression: "unsubscribe" })).toBe("unsubscribed");
  });

  it("⚠️⚠️ stops for an address that bounced or complained", () => {
    expect(stopReasonFor({ ...fine, suppression: "bounce_hard" })).toBe("bounced");
    expect(stopReasonFor({ ...fine, suppression: "bounce_soft" })).toBe("bounced");
    expect(stopReasonFor({ ...fine, suppression: "complaint" })).toBe("bounced");
  });

  it("⚠️⚠️ stops when the record's address is no longer the one enrolled", () => {
    expect(stopReasonFor({ ...fine, email: "anna@newco.example" })).toBe("email_changed");
  });

  it("does not stop for a difference in capitalisation or spacing", () => {
    expect(stopReasonFor({ ...fine, email: " Anna@Example.com " })).toBeNull();
  });

  it("⚠️ stops when the lead has been converted: the conversation moved on", () => {
    expect(stopReasonFor({ ...fine, converted: true })).toBe("converted");
  });

  it("stops when the record is gone or has no address any more", () => {
    expect(stopReasonFor({ ...fine, exists: false })).toBe("record_deleted");
    expect(stopReasonFor({ ...fine, email: " " })).toBe("missing_email");
    expect(stopReasonFor({ ...fine, email: null })).toBe("missing_email");
  });

  it("⚠️ puts an unsubscribe before everything but a deleted record", () => {
    expect(stopReasonFor({ ...fine, email: null, suppression: "unsubscribe", converted: true })).toBe("unsubscribed");
  });
});

describe("addresses", () => {
  it("⚠️ are compared in one form, so one person cannot be enrolled twice by capitalisation", () => {
    expect(normaliseEmail(" Anna@Example.COM ")).toBe("anna@example.com");
  });
});

describe("saving a sequence", () => {
  const input = { name: " Benvenuto ", entityType: "lead", isActive: true, steps };

  it("keeps a valid sequence, tidied", () => {
    const r = cleanSequence(input);
    expect(r.ok && r.value).toMatchObject({ name: "Benvenuto", entityType: "lead", description: null });
  });

  it("⚠️⚠️ refuses a placeholder nothing will fill in, before a customer reads it", () => {
    const r = cleanSequence({
      ...input,
      steps: [{ delayDays: 0, subject: "Ciao {{nome_cliente}}", body: "<p>x</p>" }],
    });
    expect(r).toEqual({
      ok: false,
      error: "validation.sequences.stepUnknownPlaceholders",
      params: { step: 1, names: "nome_cliente" },
    });
  });

  it("accepts the placeholders the catalogue knows", () => {
    const r = cleanSequence({ ...input, steps: [{ delayDays: 0, subject: "Ciao {{firstName}}", body: "<p>x</p>" }] });
    expect(r.ok).toBe(true);
  });

  it("⚠️ refuses a step with no text, which the editor leaves as an empty paragraph", () => {
    expect(cleanSequence({ ...input, steps: [{ delayDays: 0, subject: "s", body: "<p></p>" }] }).ok).toBe(false);
    expect(cleanSequence({ ...input, steps: [{ delayDays: 0, subject: "s", body: "<p>&nbsp;</p>" }] }).ok).toBe(false);
  });

  it("refuses no steps, too many, a negative wait, no subject and an unknown record type", () => {
    expect(cleanSequence({ ...input, steps: [] }).ok).toBe(false);
    expect(cleanSequence({ ...input, steps: Array(MAX_STEPS + 1).fill(steps[0]) }).ok).toBe(false);
    expect(cleanSequence({ ...input, steps: [{ ...steps[0], delayDays: -1 }] }).ok).toBe(false);
    expect(cleanSequence({ ...input, steps: [{ ...steps[0], subject: " " }] }).ok).toBe(false);
    expect(cleanSequence({ ...input, entityType: "deal" }).ok).toBe(false);
  });
});

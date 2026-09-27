/**
 * Follow-up sequences: when to send, when to stop, what can be saved.
 *
 * ⚠️ Every mistake here is an email a customer should not have received.
 */
import { describe, expect, it } from "vitest";

import {
  afterSending,
  cleanSequence,
  dueAt,
  MAX_STEPS,
  normaliseEmail,
  type SendSchedule,
  stopReasonFor,
  threading,
} from "./sequence-plan";

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

  it("⚠️⚠️ leaves somebody the assistant is working with to the assistant", () => {
    expect(stopReasonFor({ ...fine, withAssistant: true })).toBe("with_assistant");
    expect(stopReasonFor({ ...fine, withAssistant: false })).toBeNull();
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

describe("⚠️⚠️ working days and a sending window, on the workspace's clock", () => {
  const rome = (over: Partial<SendSchedule> = {}): SendSchedule => ({
    businessDays: false,
    sendFrom: null,
    sendUntil: null,
    zone: "Europe/Rome",
    ...over,
  });
  const at = (iso: string) => new Date(iso);

  it("with nothing set, a day is twenty-four hours, as it always was", () => {
    expect(dueAt(now, 3, rome())).toEqual(dueAt(now, 3));
    // Half a window is no window.
    expect(dueAt(now, 3, rome({ sendFrom: "09:00" }))).toEqual(dueAt(now, 3));
  });

  it("⚠️⚠️ counts Monday to Friday and never lands on a weekend", () => {
    const business = rome({ businessDays: true });
    // Friday 16:00 in Rome, one working day later: Monday 16:00.
    expect(dueAt(at("2026-09-18T14:00:00Z"), 1, business)).toEqual(at("2026-09-21T14:00:00Z"));
    // Friday plus three working days is Wednesday: the weekend is not counted, not merely skipped.
    expect(dueAt(at("2026-09-18T14:00:00Z"), 3, business)).toEqual(at("2026-09-23T14:00:00Z"));
    // Tuesday plus four working days is Monday, not Saturday.
    expect(dueAt(at("2026-09-15T09:00:00Z"), 4, business)).toEqual(at("2026-09-21T09:00:00Z"));
    // Enrolled on a Saturday, the first step waits for Monday.
    expect(dueAt(at("2026-09-19T08:00:00Z"), 0, business)).toEqual(at("2026-09-21T08:00:00Z"));
  });

  it("⚠️ before the window moves to its start; at or after its end, to the next day's", () => {
    const window = rome({ sendFrom: "09:00", sendUntil: "18:00" });
    // 07:00 in Rome → 09:00 the same day.
    expect(dueAt(at("2026-09-15T05:00:00Z"), 0, window)).toEqual(at("2026-09-15T07:00:00Z"));
    // 12:00 is inside: unchanged.
    expect(dueAt(at("2026-09-15T10:00:00Z"), 0, window)).toEqual(at("2026-09-15T10:00:00Z"));
    // 18:00 exactly is outside.
    expect(dueAt(at("2026-09-15T16:00:00Z"), 0, window)).toEqual(at("2026-09-16T07:00:00Z"));
    // Friday 19:00: Saturday 09:00 by the calendar, Monday 09:00 on working days.
    expect(dueAt(at("2026-09-18T17:00:00Z"), 0, window)).toEqual(at("2026-09-19T07:00:00Z"));
    expect(dueAt(at("2026-09-18T17:00:00Z"), 0, { ...window, businessDays: true })).toEqual(at("2026-09-21T07:00:00Z"));
  });

  it("⚠️ ten o'clock stays ten o'clock across the change of hour", () => {
    // Friday 23 October 10:00 CEST, three days on: Monday 26 October 10:00 CET.
    expect(dueAt(at("2026-10-23T08:00:00Z"), 3, rome({ sendFrom: "09:00", sendUntil: "18:00" }))).toEqual(
      at("2026-10-26T09:00:00Z"),
    );
  });

  it("afterSending schedules the next step by the same rules", () => {
    const next = afterSending(
      0,
      [steps[0], { ...steps[1], delayDays: 1 }],
      at("2026-09-18T14:00:00Z"),
      rome({ businessDays: true }),
    );
    expect(next.nextSendAt).toEqual(at("2026-09-21T14:00:00Z"));
  });
});

describe("⚠️⚠️ one conversation, not five emails", () => {
  const ID = "<seq-e1@crm.example>";

  it("the first email starts the thread under the id we give it", () => {
    expect(threading({ replyInThread: false }, { id: null, subject: null }, "Ciao Anna", ID)).toEqual({
      subject: "Ciao Anna",
      messageHeaderId: ID,
      inReplyTo: null,
      startsThread: true,
    });
  });

  it("a reply answers it under Re: the first subject, whatever its own says", () => {
    expect(threading({ replyInThread: true }, { id: ID, subject: "Ciao Anna" }, "ignored", "<other>")).toEqual({
      subject: "Re: Ciao Anna",
      messageHeaderId: null,
      inReplyTo: ID,
      startsThread: false,
    });
    // Never "Re: Re:".
    expect(threading({ replyInThread: true }, { id: ID, subject: "Re: RE: Ciao" }, "", "<x>").subject).toBe("Re: Ciao");
  });

  it("an email that is not a reply keeps its subject and answers nothing", () => {
    expect(threading({ replyInThread: false }, { id: ID, subject: "Ciao" }, "Novità?", "<x>")).toEqual({
      subject: "Novità?",
      messageHeaderId: null,
      inReplyTo: null,
      startsThread: false,
    });
  });
});

describe("saving tasks, replies and a schedule", () => {
  const base = { name: "Seq", entityType: "lead", isActive: true };
  const email = (over = {}) => ({ delayDays: 0, subject: "Ciao", body: "<p>x</p>", ...over });

  it("a task step needs a title, not a body, and an unknown kind of task is a to-do", () => {
    const r = cleanSequence({
      ...base,
      steps: [
        email(),
        { delayDays: 2, subject: "Chiama {{firstName}}", body: "", kind: "task", taskType: "call" },
        { delayDays: 2, subject: "Scrivi su LinkedIn", body: "", kind: "task", taskType: "fax" as never },
      ],
    });
    expect(r.ok && r.value.steps.slice(1)).toEqual([
      expect.objectContaining({ kind: "task", taskType: "call", replyInThread: false }),
      expect.objectContaining({ kind: "task", taskType: "todo" }),
    ]);
    expect(cleanSequence({ ...base, steps: [{ ...email(), kind: "task", subject: " " }] }).ok).toBe(false);
    expect(
      cleanSequence({ ...base, steps: [{ ...email(), kind: "task", subject: "Chiama {{nome_cliente}}" }] }).ok,
    ).toBe(false);
  });

  it("⚠️⚠️ only an email after an email can reply, and only a reply may leave the subject empty", () => {
    const ok = cleanSequence({ ...base, steps: [email(), email({ subject: "", replyInThread: true })] });
    expect(ok.ok && ok.value.steps.map((st) => st.replyInThread)).toEqual([false, true]);
    // The first email has nothing to answer.
    expect(cleanSequence({ ...base, steps: [email({ subject: "", replyInThread: true })] }).ok).toBe(false);
    // Nor does an email after a task only.
    expect(
      cleanSequence({
        ...base,
        steps: [
          { delayDays: 0, subject: "Chiama", body: "", kind: "task" },
          email({ subject: "", replyInThread: true }),
        ],
      }).ok,
    ).toBe(false);
  });

  it("keeps a window only when both ends are times and it ends after it starts", () => {
    const of = (sendFrom: string | null, sendUntil: string | null) => {
      const r = cleanSequence({ ...base, steps: [email()], businessDays: true, sendFrom, sendUntil });
      return r.ok && { businessDays: r.value.businessDays, sendFrom: r.value.sendFrom, sendUntil: r.value.sendUntil };
    };
    expect(of("09:00", "18:00")).toEqual({ businessDays: true, sendFrom: "09:00", sendUntil: "18:00" });
    expect(of("18:00", "09:00")).toMatchObject({ sendFrom: null, sendUntil: null });
    expect(of("9:00", "18:00")).toMatchObject({ sendFrom: null, sendUntil: null });
    expect(of("09:00", null)).toMatchObject({ sendFrom: null, sendUntil: null });
  });
});

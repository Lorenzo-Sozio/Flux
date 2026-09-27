import { findUnknownPlaceholders } from "@/lib/email-placeholders";
import { type Refusal, refuse } from "@/lib/i18n-message";
import { isTaskType, type TaskType } from "@/lib/task-kinds";
import { addDaysToDate, fromWallValue, toWallValue } from "@/lib/wall-clock";

/**
 * Follow-up sequences: the rules, with no database in sight.
 *
 * A sequence is a list of steps — wait so many days, then send this — and an
 * enrollment walks one person through it. Everything a mistake here costs lands on
 * a customer's inbox: an email after they answered, an email after they
 * unsubscribed, the same step twice. So the decisions live in pure functions a
 * test can pin, and src/lib/sequence-runner.ts only carries them out.
 */

export const SEQUENCE_ENTITIES = ["lead", "contact"] as const;
export type SequenceEntity = (typeof SEQUENCE_ENTITIES)[number];

export const MAX_STEPS = 10;
const DAY_MS = 86_400_000;

/** An email, or a task for the salesperson — a call, a LinkedIn message — instead (§8.4). */
export const STEP_KINDS = ["email", "task"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface SequenceStep {
  delayDays: number;
  /** The email's subject, or the task's title. */
  subject: string;
  /** The email's body, or the task's description. */
  body: string;
  kind?: StepKind;
  taskType?: TaskType | null;
  /** An email sent as a reply in the first email's thread: "Re:" its subject, answering it. */
  replyInThread?: boolean;
}

/** How a sequence keeps time: working days only, and a window of hours to send in. */
export interface SendSchedule {
  businessDays: boolean;
  /** "09:00", on the workspace's clock; no window when either end is null. */
  sendFrom: string | null;
  sendUntil: string | null;
  zone: string;
}

export type StopReason =
  | "replied"
  | "unsubscribed"
  | "bounced"
  | "converted"
  | "missing_email"
  | "record_deleted"
  | "email_changed"
  | "with_assistant"
  | "manual";

const isWeekend = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

/**
 * When a step is due: `delayDays` after the previous send, or after enrolling for the first
 * step — calendar days unless the sequence asks otherwise.
 *
 * ⚠️ With `businessDays` the days counted are Monday to Friday on the workspace's clock,
 * and nothing lands on a weekend. With a window, a time before it moves to its start and a
 * time at or after its end moves to the next (working) day's start: a follow-up at 23:40
 * is read by nobody and looks like what it is.
 */
export function dueAt(from: Date, delayDays: number, schedule?: SendSchedule): Date {
  if (!schedule || (!schedule.businessDays && !(schedule.sendFrom && schedule.sendUntil))) {
    return new Date(from.getTime() + delayDays * DAY_MS);
  }
  const { zone } = schedule;
  const wall = toWallValue(from, zone);
  let day = wall.slice(0, 10);
  let time = wall.slice(11, 16);
  if (schedule.businessDays) {
    for (let left = delayDays; left > 0; ) {
      day = addDaysToDate(day, 1);
      if (!isWeekend(day)) left--;
    }
    while (isWeekend(day)) day = addDaysToDate(day, 1);
  } else {
    day = addDaysToDate(day, delayDays);
  }
  if (schedule.sendFrom && schedule.sendUntil && schedule.sendFrom < schedule.sendUntil) {
    if (time < schedule.sendFrom) time = schedule.sendFrom;
    else if (time >= schedule.sendUntil) {
      day = addDaysToDate(day, 1);
      if (schedule.businessDays) while (isWeekend(day)) day = addDaysToDate(day, 1);
      time = schedule.sendFrom;
    }
  }
  return fromWallValue(`${day}T${time}`, zone) ?? new Date(from.getTime() + delayDays * DAY_MS);
}

/**
 * The headers and subject of an email step, given the thread the enrollment has so far.
 *
 * The first email starts the thread: it carries a Message-ID we choose, which is stored.
 * A later step marked `replyInThread` answers it — "Re:" the first subject, whatever the
 * step says, because a different subject is where mail clients split a thread.
 */
export function threading(
  step: Pick<SequenceStep, "replyInThread">,
  thread: { id: string | null; subject: string | null },
  subject: string,
  newId: string,
): { subject: string; messageHeaderId: string | null; inReplyTo: string | null; startsThread: boolean } {
  if (!thread.id) return { subject, messageHeaderId: newId, inReplyTo: null, startsThread: true };
  if (step.replyInThread) {
    const base = (thread.subject ?? subject).replace(/^(re:\s*)+/i, "");
    return { subject: `Re: ${base}`, messageHeaderId: null, inReplyTo: thread.id, startsThread: false };
  }
  return { subject, messageHeaderId: null, inReplyTo: null, startsThread: false };
}

/**
 * What sending step `index` does to the enrollment, decided before the email is
 * queued so the claim and the send agree.
 */
export function afterSending(
  index: number,
  steps: readonly Pick<SequenceStep, "delayDays">[],
  now: Date,
  schedule?: SendSchedule,
): { nextStep: number; nextSendAt: Date | null; status: "active" | "completed" } {
  const nextStep = index + 1;
  if (nextStep >= steps.length) return { nextStep, nextSendAt: null, status: "completed" };
  return { nextStep, nextSendAt: dueAt(now, steps[nextStep].delayDays, schedule), status: "active" };
}

export interface RecipientState {
  /** The record still exists. */
  exists: boolean;
  /** The record's address now. */
  email: string | null | undefined;
  /** The address the enrollment was made with, lower-cased. */
  enrolledEmail: string;
  /** For a lead: converted into a contact, so the sales conversation moved on. */
  converted?: boolean;
  /** The reason on the suppression list for this address, if any. */
  suppression?: string | null;
  /** An AI assistant is working with this person (src/lib/assistant-handling.ts). */
  withAssistant?: boolean;
}

/**
 * Why an enrollment must stop instead of sending, or null to send.
 *
 * ⚠️⚠️ Checked at every send, not only at enrolment. An address can be
 * unsubscribed from a campaign, bounce, or be converted days after it was
 * enrolled; the email scheduled for next Tuesday knows nothing about that unless
 * somebody asks again on Tuesday.
 */
export function stopReasonFor(r: RecipientState): StopReason | null {
  if (!r.exists) return "record_deleted";
  if (r.suppression)
    return r.suppression.startsWith("bounce") || r.suppression === "complaint" ? "bounced" : "unsubscribed";
  if (!r.email?.trim()) return "missing_email";
  // ⚠️ Sends only to the address it was enrolled with. A record whose address
  // changed — or two records merged, each enrolled under its own address — would
  // otherwise receive the sequence at the new address as many times as it has
  // enrollments, and replies and unsubscribes, matched on the enrolled address,
  // would stop none of them.
  if (normaliseEmail(r.email) !== r.enrolledEmail) return "email_changed";
  if (r.converted) return "converted";
  // ⚠️ The assistant has them: two systems following up on one person is how they get
  // written to twice in a week. Refused at enrolment, stopped at the next step.
  if (r.withAssistant) return "with_assistant";
  return null;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface SequenceInput {
  name: string;
  description?: string | null;
  entityType: string;
  isActive: boolean;
  steps: SequenceStep[];
  businessDays?: boolean;
  sendFrom?: string | null;
  sendUntil?: string | null;
}

export type CleanSequence = Omit<SequenceInput, "entityType"> & { entityType: SequenceEntity };

const isBlankHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim() === "";

/** A sequence as it will be stored, or the reason it cannot be. */
export function cleanSequence(input: SequenceInput): { ok: true; value: CleanSequence } | Refusal {
  const name = input.name.trim().slice(0, 120);
  if (!name) return refuse("validation.sequences.nameRequired");
  if (!(SEQUENCE_ENTITIES as readonly string[]).includes(input.entityType)) {
    return refuse("validation.sequences.entityUnknown");
  }
  if (input.steps.length === 0) return refuse("validation.sequences.stepsRequired");
  if (input.steps.length > MAX_STEPS) return refuse("validation.sequences.tooManySteps", { max: MAX_STEPS });

  const steps: SequenceStep[] = [];
  let emailsBefore = 0;
  for (const [i, step] of input.steps.entries()) {
    const n = i + 1;
    const delayDays = Math.trunc(Number(step.delayDays));
    if (!(delayDays >= 0 && delayDays <= 365)) return refuse("validation.sequences.stepDelayRange", { step: n });
    const kind: StepKind = step.kind === "task" ? "task" : "email";
    // Only an email that has one before it can answer in its thread.
    const replyInThread = kind === "email" && emailsBefore > 0 && Boolean(step.replyInThread);
    const subject = step.subject.trim().slice(0, 200);
    // A reply in the thread takes the first email's subject, so it needs none of its own.
    if (!subject && !replyInThread) return refuse("validation.sequences.stepSubjectRequired", { step: n });
    if (kind === "task") {
      if (step.body.length > 10_000) return refuse("validation.sequences.stepBodyTooLong", { step: n });
      const unknown = findUnknownPlaceholders(`${subject} ${step.body}`);
      if (unknown.length)
        return refuse("validation.sequences.stepUnknownPlaceholders", { step: n, names: unknown.join(", ") });
      steps.push({
        delayDays,
        subject,
        body: step.body,
        kind,
        taskType: isTaskType(step.taskType) ? step.taskType : "todo",
        replyInThread: false,
      });
      continue;
    }
    emailsBefore++;
    if (isBlankHtml(step.body)) return refuse("validation.sequences.stepBodyRequired", { step: n });
    if (step.body.length > 100_000) return refuse("validation.sequences.stepBodyTooLong", { step: n });
    // A placeholder nothing fills in reaches the customer exactly as typed.
    const unknown = findUnknownPlaceholders(`${subject} ${step.body}`);
    if (unknown.length)
      return refuse("validation.sequences.stepUnknownPlaceholders", { step: n, names: unknown.join(", ") });
    steps.push({ delayDays, subject, body: step.body, kind, taskType: null, replyInThread });
  }

  const time = (v: string | null | undefined) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
  const sendFrom = time(input.sendFrom);
  const sendUntil = time(input.sendUntil);
  // Half a window, or one that ends before it starts, is no window.
  const window =
    sendFrom && sendUntil && sendFrom < sendUntil ? { sendFrom, sendUntil } : { sendFrom: null, sendUntil: null };

  return {
    ok: true,
    value: {
      name,
      description: input.description?.trim().slice(0, 500) || null,
      entityType: input.entityType as SequenceEntity,
      isActive: input.isActive,
      steps,
      businessDays: Boolean(input.businessDays),
      ...window,
    },
  };
}

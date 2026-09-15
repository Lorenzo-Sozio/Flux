import { findUnknownPlaceholders } from "@/lib/email-placeholders";

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

export interface SequenceStep {
  delayDays: number;
  subject: string;
  body: string;
}

export type StopReason =
  | "replied"
  | "unsubscribed"
  | "bounced"
  | "converted"
  | "missing_email"
  | "record_deleted"
  | "email_changed"
  | "manual";

/**
 * When a step is due: `delayDays` after the previous send, or after enrolling for
 * the first step. Days, not business days — a sequence that skips weekends is a
 * setting somebody can ask for; one that silently shifts its dates is not.
 */
export function dueAt(from: Date, delayDays: number): Date {
  return new Date(from.getTime() + delayDays * DAY_MS);
}

/**
 * What sending step `index` does to the enrollment, decided before the email is
 * queued so the claim and the send agree.
 */
export function afterSending(
  index: number,
  steps: readonly Pick<SequenceStep, "delayDays">[],
  now: Date,
): { nextStep: number; nextSendAt: Date | null; status: "active" | "completed" } {
  const nextStep = index + 1;
  if (nextStep >= steps.length) return { nextStep, nextSendAt: null, status: "completed" };
  return { nextStep, nextSendAt: dueAt(now, steps[nextStep].delayDays), status: "active" };
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
}

export type CleanSequence = Omit<SequenceInput, "entityType"> & { entityType: SequenceEntity };

const isBlankHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim() === "";

/** A sequence as it will be stored, or the reason it cannot be. */
export function cleanSequence(input: SequenceInput): { ok: true; value: CleanSequence } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "A sequence needs a name." };
  if (!(SEQUENCE_ENTITIES as readonly string[]).includes(input.entityType)) {
    return { ok: false, error: "A sequence is for leads or for contacts." };
  }
  if (input.steps.length === 0) return { ok: false, error: "A sequence needs at least one step." };
  if (input.steps.length > MAX_STEPS) return { ok: false, error: `A sequence has at most ${MAX_STEPS} steps.` };

  const steps: SequenceStep[] = [];
  for (const [i, step] of input.steps.entries()) {
    const n = i + 1;
    const delayDays = Math.trunc(Number(step.delayDays));
    if (!(delayDays >= 0 && delayDays <= 365)) return { ok: false, error: `Step ${n}: wait between 0 and 365 days.` };
    const subject = step.subject.trim().slice(0, 200);
    if (!subject) return { ok: false, error: `Step ${n} needs a subject.` };
    if (isBlankHtml(step.body)) return { ok: false, error: `Step ${n} has no text.` };
    if (step.body.length > 100_000) return { ok: false, error: `Step ${n} is too long.` };
    // A placeholder nothing fills in reaches the customer exactly as typed.
    const unknown = findUnknownPlaceholders(`${subject} ${step.body}`);
    if (unknown.length) return { ok: false, error: `Step ${n} uses unknown placeholders: ${unknown.join(", ")}` };
    steps.push({ delayDays, subject, body: step.body });
  }

  return {
    ok: true,
    value: {
      name,
      description: input.description?.trim().slice(0, 500) || null,
      entityType: input.entityType as SequenceEntity,
      isActive: input.isActive,
      steps,
    },
  };
}

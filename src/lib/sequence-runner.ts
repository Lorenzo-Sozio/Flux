import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";

import {
  businessCalendar,
  companies,
  contacts,
  emailJobs,
  emailSequenceEnrollments,
  emailSequenceSteps,
  emailSequences,
  emailSuppressions,
  leads,
  tasks,
} from "@/db/schema";
import { getAppUrl } from "@/lib/app-url";
import { FALLBACK_CALENDAR } from "@/lib/business-calendar";
import { type EmailBrand, personalEmail, placesSignature, type SignatureVariant } from "@/lib/email-brand";
import { brandValues, loadEmailBrand, signatureFor } from "@/lib/email-brand-load";
import { ensureUnsubscribe, renderPlaceholders, valuesForRecipient } from "@/lib/email-placeholders";
import { notify } from "@/lib/notify";
import {
  afterSending,
  dueAt,
  normaliseEmail,
  type SendSchedule,
  type SequenceEntity,
  type StopReason,
  stopReasonFor,
  threading,
} from "@/lib/sequence-plan";
import { generateUnsubscribeToken } from "@/lib/unsubscribe-token";

/**
 * The workspace's clock, read from the database this runner was handed — not through
 * getDb(), which a scheduled job has no request header to resolve.
 */
async function workspaceZone(db: AnyDb): Promise<string> {
  try {
    const [row] = await db.select({ timeZone: businessCalendar.timeZone }).from(businessCalendar).limit(1);
    return row?.timeZone ?? FALLBACK_CALENDAR.timeZone;
  } catch {
    return FALLBACK_CALENDAR.timeZone;
  }
}

/** A sequence's way of keeping time, on the workspace's clock (src/lib/sequence-plan.ts). */
function scheduleOf(
  sequence: { businessDays?: boolean | null; sendFrom?: string | null; sendUntil?: string | null },
  zone: string,
): SendSchedule {
  return {
    businessDays: Boolean(sequence.businessDays),
    sendFrom: sequence.sendFrom ?? null,
    sendUntil: sequence.sendUntil ?? null,
    zone,
  };
}

/** The domain our own Message-IDs are written under: the app's, so they are ours. */
function messageIdDomain(): string {
  try {
    return new URL(getAppUrl()).hostname;
  } catch {
    return "fluxcrm.app";
  }
}

/**
 * Carrying follow-up sequences out: enrolling, stopping, and sending the next step.
 *
 * The decisions are in src/lib/sequence-plan.ts. This file is the part that has to
 * be right about concurrency on a driver with no transactions:
 *
 *   * **Enrolling** relies on a partial unique index, so two enrolments of the same
 *     address racing produce one enrollment, not two copies of every email.
 *   * **Sending** claims the step with a conditional update on `next_step` before
 *     queuing the email, so two overlapping worker runs queue it once.
 *   * **Stopping** cancels the email already queued for the enrollment, so a reply
 *     that arrives a minute after the step was queued still stops that step.
 */

// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
type AnyDb = any;

/** Marks unsubscribe tokens that belong to a sequence rather than a campaign log. */
export const SEQUENCE_TOKEN_PREFIX = "seq:";

export type EnrollResult =
  | { ok: true; enrollmentId: string }
  | { ok: false; reason: "sequence_unavailable" | "no_steps" | "already_enrolled" | StopReason };

interface Recipient {
  exists: boolean;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  phone: string | null;
  ownerId: string | null;
  converted: boolean;
  withAssistant: boolean;
}

async function loadRecipient(db: AnyDb, entity: SequenceEntity, id: string): Promise<Recipient> {
  const missing: Recipient = {
    exists: false,
    email: null,
    firstName: null,
    lastName: null,
    company: null,
    jobTitle: null,
    phone: null,
    ownerId: null,
    converted: false,
    withAssistant: false,
  };
  if (entity === "lead") {
    const [row] = await db.select().from(leads).where(eq(leads.id, id));
    if (!row) return missing;
    return {
      exists: true,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.companyName,
      jobTitle: row.jobTitle,
      phone: row.phone ?? row.mobile,
      ownerId: row.ownerId,
      converted: Boolean(row.isConverted),
      withAssistant: Boolean(row.assistantSince),
    };
  }
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) return missing;
  const [company] = row.companyId
    ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, row.companyId))
    : [];
  return {
    exists: true,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    company: company?.name ?? null,
    jobTitle: row.jobTitle,
    phone: row.phone ?? row.mobile,
    ownerId: row.ownerId,
    converted: false,
    withAssistant: Boolean(row.assistantSince),
  };
}

async function suppressionFor(db: AnyDb, email: string): Promise<string | null> {
  const [row] = await db
    .select({ reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, normaliseEmail(email)));
  return row?.reason ?? null;
}

async function orderedSteps(db: AnyDb, sequenceId: string) {
  return db
    .select()
    .from(emailSequenceSteps)
    .where(eq(emailSequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(emailSequenceSteps.position));
}

// ─── Enrolling ────────────────────────────────────────────────────────────────

export async function enroll(
  db: AnyDb,
  input: {
    sequenceId: string;
    entity: SequenceEntity;
    recordId: string;
    enrolledBy: string | null;
    now?: Date;
    zone?: string;
  },
): Promise<EnrollResult> {
  const now = input.now ?? new Date();
  const [sequence] = await db.select().from(emailSequences).where(eq(emailSequences.id, input.sequenceId));
  if (!sequence || !sequence.isActive || sequence.entityType !== input.entity) {
    return { ok: false, reason: "sequence_unavailable" };
  }
  const steps = await orderedSteps(db, sequence.id);
  if (steps.length === 0) return { ok: false, reason: "no_steps" };

  const recipient = await loadRecipient(db, input.entity, input.recordId);
  const email = recipient.email ? normaliseEmail(recipient.email) : "";
  const refusal = stopReasonFor({
    ...recipient,
    enrolledEmail: email,
    suppression: email ? await suppressionFor(db, email) : null,
  });
  if (refusal) return { ok: false, reason: refusal };

  const inserted = await db
    .insert(emailSequenceEnrollments)
    .values({
      sequenceId: sequence.id,
      leadId: input.entity === "lead" ? input.recordId : null,
      contactId: input.entity === "contact" ? input.recordId : null,
      email,
      status: "active",
      nextStep: 0,
      nextSendAt: dueAt(now, steps[0].delayDays, scheduleOf(sequence, input.zone ?? (await workspaceZone(db)))),
      ownerId: recipient.ownerId ?? sequence.ownerId ?? input.enrolledBy,
      enrolledBy: input.enrolledBy,
      enrolledAt: now,
    })
    // The partial unique index on (sequence, email) where active decides.
    .onConflictDoNothing()
    .returning({ id: emailSequenceEnrollments.id });
  if (inserted.length === 0) return { ok: false, reason: "already_enrolled" };
  return { ok: true, enrollmentId: inserted[0].id };
}

// ─── Stopping ─────────────────────────────────────────────────────────────────

/**
 * Stops the given active enrollments and cancels any email still queued for them.
 * Returns the ones this call stopped — not ones another call had already stopped.
 */
export async function stopEnrollments(
  db: AnyDb,
  ids: string[],
  reason: StopReason,
  now = new Date(),
): Promise<{ id: string; ownerId: string | null; sequenceId: string; email: string }[]> {
  if (ids.length === 0) return [];
  const stopped = await db
    .update(emailSequenceEnrollments)
    .set({ status: "stopped", stopReason: reason, stoppedAt: now, nextSendAt: null })
    .where(and(inArray(emailSequenceEnrollments.id, ids), eq(emailSequenceEnrollments.status, "active")))
    .returning({
      id: emailSequenceEnrollments.id,
      ownerId: emailSequenceEnrollments.ownerId,
      sequenceId: emailSequenceEnrollments.sequenceId,
      email: emailSequenceEnrollments.email,
    });
  if (stopped.length) {
    await db
      .update(emailJobs)
      .set({ status: "cancelled" })
      .where(
        and(
          inArray(
            emailJobs.sequenceEnrollmentId,
            stopped.map((s: { id: string }) => s.id),
          ),
          eq(emailJobs.status, "pending"),
        ),
      );
  }
  return stopped;
}

async function activeFor(db: AnyDb, email: string, before?: Date): Promise<string[]> {
  const rows = await db
    .select({ id: emailSequenceEnrollments.id })
    .from(emailSequenceEnrollments)
    .where(
      and(
        eq(emailSequenceEnrollments.email, normaliseEmail(email)),
        eq(emailSequenceEnrollments.status, "active"),
        // A message written before somebody was enrolled cannot be a reply to that sequence.
        ...(before ? [lt(emailSequenceEnrollments.enrolledAt, before)] : []),
      ),
    );
  return rows.map((r: { id: string }) => r.id);
}

/**
 * Someone wrote in: every sequence writing to them stops, and whoever owns each
 * enrollment is told, because the conversation is now a person's to pick up.
 */
export async function stopOnReply(db: AnyDb, fromEmail: string, now = new Date(), writtenAt?: Date) {
  const stopped = await stopEnrollments(db, await activeFor(db, fromEmail, writtenAt), "replied", now);
  for (const s of stopped) {
    if (!s.ownerId) continue;
    const [sequence] = await db
      .select({ name: emailSequences.name })
      .from(emailSequences)
      .where(eq(emailSequences.id, s.sequenceId));
    await notify({
      userId: s.ownerId,
      type: "sequence_reply",
      key: "sequenceReply",
      params: { email: s.email, sequence: sequence?.name ?? "—" },
      link: `/dashboard/marketing/sequences/${s.sequenceId}`,
    }).catch(() => undefined);
  }
  return stopped.length;
}

/** An address was unsubscribed or suppressed: nothing more goes to it from any sequence. */
export async function stopForAddress(db: AnyDb, email: string, reason: "unsubscribed" | "bounced", now = new Date()) {
  return (await stopEnrollments(db, await activeFor(db, email), reason, now)).length;
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/**
 * Queues the next step of every enrollment that is due, in sequences not paused.
 *
 * Runs inside the email worker, once a minute per workspace, so what it queues is
 * sent by the same run or the next.
 */
export async function advanceSequences(db: AnyDb, now = new Date(), limit = 50, zone?: string) {
  const running: string[] = (
    await db.select({ id: emailSequences.id }).from(emailSequences).where(eq(emailSequences.isActive, true))
  ).map((r: { id: string }) => r.id);
  if (running.length === 0) return { due: 0, queued: 0, stopped: 0, completed: 0 };
  const due = await db
    .select()
    .from(emailSequenceEnrollments)
    .where(
      and(
        eq(emailSequenceEnrollments.status, "active"),
        lte(emailSequenceEnrollments.nextSendAt, now),
        // ⚠️ Paused sequences are left out here, not skipped below: fifty due enrollments in
        // paused sequences filled every page, and no step of any running sequence was sent.
        inArray(emailSequenceEnrollments.sequenceId, running),
      ),
    )
    .orderBy(asc(emailSequenceEnrollments.nextSendAt))
    .limit(limit);
  if (due.length === 0) return { due: 0, queued: 0, stopped: 0, completed: 0 };

  const sequenceIds: string[] = [...new Set<string>(due.map((e: { sequenceId: string }) => e.sequenceId))];
  const sequences = await db.select().from(emailSequences).where(inArray(emailSequences.id, sequenceIds));
  const byId = new Map(sequences.map((s: { id: string }) => [s.id, s]));
  const clock = zone ?? (await workspaceZone(db));
  const stepsBySequence = new Map<string, Awaited<ReturnType<typeof orderedSteps>>>();

  let queued = 0;
  let stopped = 0;
  let completed = 0;

  // The owner's signature, as on an email they write by hand (src/lib/email-brand.ts): full on the
  // first email, compact on a reply in the thread. Read once per run, and only if an email is due.
  let brand: EmailBrand | null | undefined;
  const signatures = new Map<string, string>();
  const signatureOf = async (ownerId: string | null, variant: SignatureVariant): Promise<string> => {
    if (!ownerId) return "";
    if (brand === undefined) brand = await loadEmailBrand(db).catch(() => null);
    if (!brand) return "";
    const key = `${ownerId}:${variant}`;
    if (!signatures.has(key)) {
      signatures.set(key, await signatureFor(db, ownerId, brand, variant, "it").catch(() => ""));
    }
    return signatures.get(key) ?? "";
  };

  for (const enrollment of due) {
    const sequence = byId.get(enrollment.sequenceId) as
      | {
          isActive: boolean;
          entityType: SequenceEntity;
          businessDays?: boolean | null;
          sendFrom?: string | null;
          sendUntil?: string | null;
        }
      | undefined;
    // Deleted since the page was read. A paused one never reaches here: the due query leaves it
    // out, and its enrollments wait where they are until it resumes.
    if (!sequence) continue;

    if (!stepsBySequence.has(enrollment.sequenceId)) {
      stepsBySequence.set(enrollment.sequenceId, await orderedSteps(db, enrollment.sequenceId));
    }
    const steps = stepsBySequence.get(enrollment.sequenceId) ?? [];
    const step = steps[enrollment.nextStep];

    // Steps were removed since this enrollment was scheduled: there is nothing left to send.
    if (!step) {
      const done = await db
        .update(emailSequenceEnrollments)
        .set({ status: "completed", completedAt: now, nextSendAt: null })
        .where(
          and(
            eq(emailSequenceEnrollments.id, enrollment.id),
            eq(emailSequenceEnrollments.status, "active"),
            eq(emailSequenceEnrollments.nextStep, enrollment.nextStep),
          ),
        )
        .returning({ id: emailSequenceEnrollments.id });
      completed += done.length;
      continue;
    }

    const entity: SequenceEntity = enrollment.leadId ? "lead" : "contact";
    const recipient = await loadRecipient(db, entity, enrollment.leadId ?? enrollment.contactId);
    const reason = stopReasonFor({
      ...recipient,
      enrolledEmail: enrollment.email,
      suppression: await suppressionFor(db, enrollment.email),
    });
    if (reason) {
      stopped += (await stopEnrollments(db, [enrollment.id], reason, now)).length;
      continue;
    }

    const next = afterSending(enrollment.nextStep, steps, now, scheduleOf(sequence, clock));
    const isTask = step.kind === "task";
    const unsubscribeUrl = `${getAppUrl()}/api/unsubscribe?token=${generateUnsubscribeToken(
      enrollment.email,
      `${SEQUENCE_TOKEN_PREFIX}${enrollment.id}`,
    )}`;
    const values = valuesForRecipient({ ...recipient, email: enrollment.email, unsubscribeUrl });
    // ⚠️ A reply carries no subject of its own. When there is no thread to borrow one from
    // (the first email went out before threads were recorded) it takes the first email's,
    // rather than leaving with an empty subject line.
    const ownSubject = step.subject.trim()
      ? step.subject
      : (steps.find((st: { kind?: string | null; subject: string }) => st.kind !== "task" && st.subject.trim())
          ?.subject ?? "");
    // The thread the enrollment has so far, and what this email does to it.
    const thread = isTask
      ? null
      : threading(
          step,
          { id: enrollment.threadMessageId ?? null, subject: enrollment.threadSubject ?? null },
          renderPlaceholders(ownSubject, values),
          `<seq-${enrollment.id}@${messageIdDomain()}>`,
        );
    const claimed = await db
      .update(emailSequenceEnrollments)
      .set({
        nextStep: next.nextStep,
        nextSendAt: next.nextSendAt,
        status: next.status,
        lastSentAt: now,
        completedAt: next.status === "completed" ? now : null,
        // Written with the claim, so the id a later step answers is the one this email carries.
        ...(thread?.startsThread ? { threadMessageId: thread.messageHeaderId, threadSubject: thread.subject } : {}),
      })
      .where(
        and(
          eq(emailSequenceEnrollments.id, enrollment.id),
          eq(emailSequenceEnrollments.status, "active"),
          eq(emailSequenceEnrollments.nextStep, enrollment.nextStep),
        ),
      )
      .returning({ id: emailSequenceEnrollments.id });
    // Another run took this step, or the enrollment was stopped in the meantime.
    if (claimed.length === 0) continue;

    try {
      if (isTask) {
        // A call, a LinkedIn message: the salesperson's to do, today, on the record (§8.4).
        await db.insert(tasks).values({
          title: renderPlaceholders(step.subject, values).slice(0, 200),
          description: step.body ? renderPlaceholders(step.body, values) : null,
          type: step.taskType ?? "todo",
          status: "todo",
          dueDate: now,
          allDay: true,
          ownerId: enrollment.ownerId,
          assigneeId: enrollment.ownerId,
          leadId: enrollment.leadId,
          contactId: enrollment.contactId,
        });
      } else {
        await db.insert(emailJobs).values({
          toEmail: enrollment.email,
          subject: thread?.subject ?? renderPlaceholders(step.subject, values),
          // Every automated email carries a way out, written by the author or not.
          htmlBody: await (async () => {
            const signature = await signatureOf(enrollment.ownerId, thread?.inReplyTo ? "compact" : "full");
            const body = renderPlaceholders(step.body, {
              ...values,
              ...(brand ? brandValues(brand, signature) : {}),
            });
            // A step that places `{{firma}}` itself gets it there, and not again at the end.
            return ensureUnsubscribe(personalEmail(body, placesSignature(step.body) ? "" : signature), unsubscribeUrl);
          })(),
          status: "pending",
          scheduledAt: now,
          sequenceEnrollmentId: enrollment.id,
          messageHeaderId: thread?.messageHeaderId ?? null,
          inReplyTo: thread?.inReplyTo ?? null,
        });
      }
      queued++;
      if (next.status === "completed") completed++;
    } catch (err) {
      // Give the step back, so the next run sends it rather than skipping it.
      await db
        .update(emailSequenceEnrollments)
        .set({
          nextStep: enrollment.nextStep,
          nextSendAt: enrollment.nextSendAt,
          status: "active",
          lastSentAt: enrollment.lastSentAt,
          completedAt: null,
          // And the thread, or the retry would send the first email without the id it records.
          threadMessageId: enrollment.threadMessageId ?? null,
          threadSubject: enrollment.threadSubject ?? null,
        })
        .where(
          and(eq(emailSequenceEnrollments.id, enrollment.id), eq(emailSequenceEnrollments.nextStep, next.nextStep)),
        );
      throw err;
    }
  }

  return { due: due.length, queued, stopped, completed };
}

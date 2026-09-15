"use server";

import { revalidatePath } from "next/cache";

import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";

import { contacts, emailSequenceEnrollments, emailSequenceSteps, emailSequences, leads } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { cleanSequence, type SequenceEntity, type SequenceInput, type StopReason } from "@/lib/sequence-plan";
import { enroll, stopEnrollments } from "@/lib/sequence-runner";
import { getDb } from "@/lib/tenant-context";

const PAGE = "/dashboard/marketing/sequences";

export type SequenceResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Whether a reply can stop a sequence at all.
 *
 * ⚠️ Replies reach Flux only through an inbound email webhook. Without one, a
 * sequence keeps writing to somebody who answered, and nothing on the screen would
 * say so — so the screen asks this and says it.
 */
export async function replyDetectionConfigured(): Promise<boolean> {
  await requireCapability("record:read");
  return Boolean(process.env.RESEND_INBOUND_WEBHOOK_SECRET || process.env.INBOUND_EMAIL_SECRET);
}

export async function getSequences() {
  await requireCapability("record:read");
  await requirePlanModule("marketing");
  const db = await getDb();
  return tolerateUnmigrated("sequences", async () => {
    const [sequences, steps, enrollments] = await Promise.all([
      db.select().from(emailSequences).orderBy(asc(emailSequences.name)),
      db
        .select({ sequenceId: emailSequenceSteps.sequenceId, n: count() })
        .from(emailSequenceSteps)
        .groupBy(emailSequenceSteps.sequenceId),
      db
        .select({
          sequenceId: emailSequenceEnrollments.sequenceId,
          status: emailSequenceEnrollments.status,
          stopReason: emailSequenceEnrollments.stopReason,
          n: count(),
        })
        .from(emailSequenceEnrollments)
        .groupBy(
          emailSequenceEnrollments.sequenceId,
          emailSequenceEnrollments.status,
          emailSequenceEnrollments.stopReason,
        ),
    ]);
    return sequences.map((s) => {
      const mine = enrollments.filter((e) => e.sequenceId === s.id);
      const sum = (f: (e: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((t, e) => t + Number(e.n), 0);
      return {
        ...s,
        stepCount: Number(steps.find((x) => x.sequenceId === s.id)?.n ?? 0),
        active: sum((e) => e.status === "active"),
        completed: sum((e) => e.status === "completed"),
        replied: sum((e) => e.stopReason === "replied"),
        stopped: sum((e) => e.status === "stopped"),
      };
    });
  }, []);
}

export async function getSequence(id: string) {
  await requireCapability("record:read");
  await requirePlanModule("marketing");
  const db = await getDb();
  const [sequence] = await db.select().from(emailSequences).where(eq(emailSequences.id, id));
  if (!sequence) return null;
  const [steps, enrollments] = await Promise.all([
    db
      .select()
      .from(emailSequenceSteps)
      .where(eq(emailSequenceSteps.sequenceId, id))
      .orderBy(asc(emailSequenceSteps.position)),
    db
      .select({
        id: emailSequenceEnrollments.id,
        email: emailSequenceEnrollments.email,
        status: emailSequenceEnrollments.status,
        stopReason: emailSequenceEnrollments.stopReason,
        nextStep: emailSequenceEnrollments.nextStep,
        nextSendAt: emailSequenceEnrollments.nextSendAt,
        lastSentAt: emailSequenceEnrollments.lastSentAt,
        enrolledAt: emailSequenceEnrollments.enrolledAt,
        leadId: emailSequenceEnrollments.leadId,
        contactId: emailSequenceEnrollments.contactId,
        leadFirst: leads.firstName,
        leadLast: leads.lastName,
        contactFirst: contacts.firstName,
        contactLast: contacts.lastName,
      })
      .from(emailSequenceEnrollments)
      .leftJoin(leads, eq(leads.id, emailSequenceEnrollments.leadId))
      .leftJoin(contacts, eq(contacts.id, emailSequenceEnrollments.contactId))
      .where(eq(emailSequenceEnrollments.sequenceId, id))
      .orderBy(desc(emailSequenceEnrollments.enrolledAt))
      .limit(500),
  ]);
  return { sequence, steps, enrollments };
}

/**
 * Creates or updates a sequence and its steps.
 *
 * ⚠️ No transaction on this driver, so the steps are written in an order that is
 * safe to interrupt: one upsert keyed on (sequence, position) for every step, then
 * one delete of the positions past the end. Stopping between the two leaves the
 * old tail in place — a longer sequence than intended, never an empty one.
 */
export async function saveSequence(id: string | null, input: SequenceInput): Promise<SequenceResult> {
  const actor = await requireCapability("sequence:manage");
  await requirePlanModule("marketing");
  const cleaned = cleanSequence(input);
  if (!cleaned.ok) return cleaned;
  const { steps, ...fields } = cleaned.value;
  const db = await getDb();

  let sequenceId = id;
  if (sequenceId) {
    const updated = await db
      .update(emailSequences)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(emailSequences.id, sequenceId))
      .returning({ id: emailSequences.id });
    if (updated.length === 0) return { ok: false, error: "This sequence no longer exists." };
  } else {
    const [row] = await db
      .insert(emailSequences)
      .values({ ...fields, ownerId: actor.userId, createdBy: actor.userId })
      .returning({ id: emailSequences.id });
    sequenceId = row.id;
  }
  const sid = sequenceId as string;

  await db
    .insert(emailSequenceSteps)
    .values(steps.map((s, position) => ({ sequenceId: sid, position, ...s })))
    .onConflictDoUpdate({
      target: [emailSequenceSteps.sequenceId, emailSequenceSteps.position],
      set: {
        delayDays: sqlExcluded("delay_days"),
        subject: sqlExcluded("subject"),
        body: sqlExcluded("body"),
      },
    });
  await db
    .delete(emailSequenceSteps)
    .where(and(eq(emailSequenceSteps.sequenceId, sid), gte(emailSequenceSteps.position, steps.length)));

  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/${sid}`);
  return { ok: true, id: sid };
}

export async function deleteSequence(id: string): Promise<{ ok: true }> {
  await requireCapability("sequence:manage");
  await requirePlanModule("marketing");
  const db = await getDb();
  // Cancel anything still queued first: the cascade removes the enrollments, and
  // with them the only way to find their queued emails.
  const active = await db
    .select({ id: emailSequenceEnrollments.id })
    .from(emailSequenceEnrollments)
    .where(and(eq(emailSequenceEnrollments.sequenceId, id), eq(emailSequenceEnrollments.status, "active")));
  await stopEnrollments(
    db,
    active.map((a) => a.id),
    "manual",
  );
  await db.delete(emailSequences).where(eq(emailSequences.id, id));
  revalidatePath(PAGE);
  return { ok: true };
}

/** Active sequences a record of this type can be enrolled in. */
export async function getSequencesForEnrolling(entity: SequenceEntity) {
  await requireCapability("record:read");
  const db = await getDb();
  return tolerateUnmigrated(
    "sequences",
    () =>
      db
        .select({ id: emailSequences.id, name: emailSequences.name })
        .from(emailSequences)
        .where(and(eq(emailSequences.entityType, entity), eq(emailSequences.isActive, true)))
        .orderBy(asc(emailSequences.name)),
    [],
  );
}

const REFUSALS: Record<string, string> = {
  sequence_unavailable: "This sequence is paused, deleted, or for another kind of record.",
  no_steps: "This sequence has no steps.",
  already_enrolled: "Already in this sequence.",
  unsubscribed: "This address has unsubscribed.",
  bounced: "Email to this address bounces.",
  missing_email: "This record has no email address.",
  converted: "This lead has already been converted.",
  record_deleted: "This record no longer exists.",
};

export async function enrollRecord(
  sequenceId: string,
  entity: SequenceEntity,
  recordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireCapability("record:write");
  await requirePlanModule("marketing");
  const db = await getDb();
  const result = await enroll(db, { sequenceId, entity, recordId, enrolledBy: actor.userId });
  if (!result.ok) return { ok: false, error: REFUSALS[result.reason] ?? "Could not enroll." };
  revalidatePath(`${PAGE}/${sequenceId}`);
  return { ok: true };
}

/** Active enrollments of one record, for its detail page. */
export async function getEnrollmentsForRecord(entity: SequenceEntity, recordId: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const column = entity === "lead" ? emailSequenceEnrollments.leadId : emailSequenceEnrollments.contactId;
  return tolerateUnmigrated(
    "sequences",
    () =>
      db
        .select({
          id: emailSequenceEnrollments.id,
          sequenceId: emailSequenceEnrollments.sequenceId,
          name: emailSequences.name,
          status: emailSequenceEnrollments.status,
          stopReason: emailSequenceEnrollments.stopReason,
          nextStep: emailSequenceEnrollments.nextStep,
          nextSendAt: emailSequenceEnrollments.nextSendAt,
        })
        .from(emailSequenceEnrollments)
        .innerJoin(emailSequences, eq(emailSequences.id, emailSequenceEnrollments.sequenceId))
        .where(eq(column, recordId))
        .orderBy(desc(emailSequenceEnrollments.enrolledAt))
        .limit(20),
    [],
  );
}

export async function stopEnrollment(id: string): Promise<{ ok: true }> {
  await requireCapability("record:write");
  const db = await getDb();
  const reason: StopReason = "manual";
  const [row] = await db
    .select({ sequenceId: emailSequenceEnrollments.sequenceId })
    .from(emailSequenceEnrollments)
    .where(eq(emailSequenceEnrollments.id, id));
  await stopEnrollments(db, [id], reason);
  if (row) revalidatePath(`${PAGE}/${row.sequenceId}`);
  return { ok: true };
}

/** The value the upsert tried to insert, for the columns it updates on conflict. */
function sqlExcluded(column: "delay_days" | "subject" | "body") {
  return sql.raw(`excluded.${column}`);
}

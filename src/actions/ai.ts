"use server";

/**
 * The copilot's actions (Fase 5, C1–C3): a summary of a record, a briefing before an
 * appointment, an email drafted or rewritten — and what the person did with each.
 *
 * ⚠️⚠️ Every export here is an endpoint any signed-in browser can call. Each one checks that
 * the caller may read the record it is about, then goes through `runAiTask`, which checks
 * `record:write`, the plan, the workspace switch and the month's allowance, and logs the call.
 * None of them changes a record or sends anything: they return a proposal.
 */
import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";

import { auth } from "@/auth";
import { appointmentAttendees, appointments } from "@/db/schema";
import { aiEntries, aiViewer } from "@/lib/ai/access";
import {
  type AiSubject,
  appointmentSubject,
  dayOf,
  loadRecordContext,
  plainText,
  renderContext,
} from "@/lib/ai/context";
import { runAiJsonTask, runAiTask } from "@/lib/ai/run";
import { AI_OUTCOMES, type AiOutcome, decideSuggestion } from "@/lib/ai/suggestions";
import {
  briefingRequest,
  draftRequest,
  EMAIL_DRAFT_SCHEMA,
  paragraphsToHtml,
  parseEmailDraft,
  summaryRequest,
  uiLanguage,
  unsupportedFigures,
} from "@/lib/ai/tasks";
import type { AiEntry } from "@/lib/ai/types";
import { requireCapability } from "@/lib/auth-guard";
import { serverT } from "@/lib/i18n-server";
import { getDb } from "@/lib/tenant-context";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

export type AiActionFailure = { ok: false; reason: string; message: string };

const SUBJECT_TYPES = new Set(["deal", "contact", "company", "lead", "ticket"]);

async function failure(reason: string): Promise<AiActionFailure> {
  const t = await serverT("aiCopilot.errors");
  return { ok: false, reason, message: t.has(reason) ? t(reason) : t("unknown") };
}

/** How the copilot's log names the record a proposal is about. */
const runSubject = (subject: AiSubject) => ({ entityType: subject.type, entityId: subject.id });

/** The record exists and the caller may read it. */
async function readableContext(subject: AiSubject) {
  if (!subject || typeof subject.id !== "string" || !SUBJECT_TYPES.has(subject.type)) return null;
  await requireCapability(subject.type === "ticket" ? "ticket:read" : "record:read");
  return loadRecordContext(await getDb(), subject, await getWorkspaceTimeZone());
}

/** C2: what a record is about, in a few lines. */
export async function summarizeRecordAction(
  subject: AiSubject,
): Promise<{ ok: true; suggestionId: string; text: string } | AiActionFailure> {
  const ctx = await readableContext(subject);
  if (!ctx) return failure("not_found");
  const run = await runAiTask("summary", summaryRequest(ctx, uiLanguage(await getLocale())), runSubject(subject));
  return run.ok ? { ok: true, suggestionId: run.suggestionId, text: run.value } : failure(run.reason);
}

/** C3: what to know before an appointment, from the record it is about. */
export async function appointmentBriefingAction(
  appointmentId: string,
): Promise<{ ok: true; suggestionId: string; text: string } | AiActionFailure> {
  if (typeof appointmentId !== "string") return failure("not_found");
  await requireCapability("record:read");
  const db = await getDb();
  const [appt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!appt) return failure("not_found");
  const subject = appointmentSubject(appt);
  if (!subject) return failure("no_record");

  const timeZone = await getWorkspaceTimeZone();
  const ctx = await loadRecordContext(db, subject, timeZone);
  if (!ctx) return failure("no_record");
  const attendees = await db
    .select({ name: appointmentAttendees.name, email: appointmentAttendees.email })
    .from(appointmentAttendees)
    .where(eq(appointmentAttendees.appointmentId, appointmentId));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(appt.startAt);

  const request = briefingRequest(
    ctx,
    {
      title: appt.title,
      when: `${dayOf(appt.startAt, timeZone)} ${time}`,
      description: appt.description,
      attendees: attendees.map((a) => a.name || a.email).filter((a): a is string => Boolean(a)),
    },
    uiLanguage(await getLocale()),
  );
  const run = await runAiTask("briefing", request, runSubject(subject));
  return run.ok ? { ok: true, suggestionId: run.suggestionId, text: run.value } : failure(run.reason);
}

/**
 * C1: an email to a contact, a lead or a company — a first draft, or the draft in the editor
 * rewritten. From a deal's page the draft is written from the deal, to its contact.
 */
export async function draftEmailAction(input: {
  entityType: "contact" | "lead" | "deal" | "company";
  entityId: string;
  instructions?: string;
  /** The editor's HTML: present means "rewrite this". */
  currentDraftHtml?: string;
}): Promise<
  { ok: true; suggestionId: string; subject: string; bodyHtml: string; unverified: string[] } | AiActionFailure
> {
  if (!["contact", "lead", "deal", "company"].includes(input?.entityType)) return failure("not_found");
  const subject: AiSubject = { type: input.entityType, id: input.entityId };
  const ctx = await readableContext(subject);
  if (!ctx) return failure("not_found");

  const actor = await requireCapability("record:write");
  const currentDraft = input.currentDraftHtml ? plainText(input.currentDraftHtml) : null;
  const instructions = input.instructions?.slice(0, 1000) ?? null;
  const request = draftRequest(ctx, { instructions, currentDraft, senderName: actor.name ?? null });

  const run = await runAiJsonTask(
    currentDraft ? "rewrite" : "draft",
    { ...request, schema: EMAIL_DRAFT_SCHEMA },
    parseEmailDraft,
    runSubject(subject),
  );
  if (!run.ok) return failure(run.reason);

  // ⚠️ The check no prompt replaces: figures the material does not contain, for the person to verify.
  const material = [renderContext(ctx), instructions ?? "", currentDraft ?? ""].join("\n");
  return {
    ok: true,
    suggestionId: run.suggestionId,
    subject: run.value.subject,
    bodyHtml: paragraphsToHtml(run.value.body),
    unverified: unsupportedFigures(`${run.value.subject}\n${run.value.body}`, material),
  };
}

/** What the person did with a proposal: decided once, by whoever asked for it. */
export async function decideAiSuggestionAction(id: string, outcome: AiOutcome): Promise<{ ok: boolean }> {
  const actor = await requireCapability("record:write");
  if (typeof id !== "string" || !AI_OUTCOMES.includes(outcome)) return { ok: false };
  return { ok: await decideSuggestion(await getDb(), id, actor.userId, outcome) };
}

/**
 * Whether the email dialog offers "Write with AI", for dialogs opened where the page did not ask
 * (a quote, an invoice, a list): the same entry the record pages read, or null when it is hidden.
 */
export async function getDraftAiEntryAction(): Promise<AiEntry | null> {
  await requireCapability("record:write");
  const session = await auth();
  return (await aiEntries(["draft"], aiViewer(session?.user))).draft ?? null;
}

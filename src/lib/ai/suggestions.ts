/**
 * The copilot's log: every call, and what a person did with its proposal (table `ai_suggestion`,
 * migration 0069).
 *
 * ⚠️ The prompt is never written here — it is the customer's data plus Flux's instructions, and
 * the record it came from is already in the database. What is written is the proposal as it was
 * shown, because that is what a person accepted, edited or threw away.
 */
import { and, eq } from "drizzle-orm";

import { aiSuggestions } from "@/db/schema";

import type { AiResult, AiTask } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type AiOutcome = "accepted" | "edited" | "discarded";
export const AI_OUTCOMES: readonly AiOutcome[] = ["accepted", "edited", "discarded"];

export async function recordSuggestion(
  db: AnyDb,
  input: {
    task: AiTask;
    userId: string;
    entityType?: string | null;
    entityId?: string | null;
    result: AiResult;
    /** What was shown: the text, or the JSON of a structured answer. */
    shown: string | null;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const { result } = input;
  await db.insert(aiSuggestions).values({
    id,
    task: input.task,
    userId: input.userId,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    provider: result.provider,
    model: result.model,
    status: result.ok ? "ok" : "failed",
    failureReason: result.ok ? null : result.reason,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    reasoningTokens: result.usage?.reasoningTokens ?? 0,
    text: result.ok ? input.shown : null,
  });
  return id;
}

/**
 * What the person did with a proposal. Decided once, and only by whoever asked for it: the
 * measure is "did the person who saw it use it", and a colleague's click would falsify it.
 *
 * Returns false when there was nothing to decide (someone else's, already decided, failed).
 */
export async function decideSuggestion(db: AnyDb, id: string, userId: string, outcome: AiOutcome): Promise<boolean> {
  if (!AI_OUTCOMES.includes(outcome)) return false;
  const rows = await db
    .update(aiSuggestions)
    .set({ outcome, decidedAt: new Date() })
    .where(
      and(
        eq(aiSuggestions.id, id),
        eq(aiSuggestions.userId, userId),
        eq(aiSuggestions.status, "ok"),
        eq(aiSuggestions.outcome, "pending"),
      ),
    )
    .returning({ id: aiSuggestions.id });
  return rows.length > 0;
}

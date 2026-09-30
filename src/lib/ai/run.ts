/**
 * The one door a copilot task goes through (Fase 5): who may ask, whether the workspace may,
 * whether the month allows it, the call, and the log — in that order, every time.
 *
 * ```ts
 * const run = await runAiTask("summary", request, { entityType: "deal", entityId });
 * if (!run.ok) … // run.reason: a refusal (plan, workspace, limit…) or the provider's failure
 * ```
 *
 * ⚠️⚠️ It returns a proposal and changes nothing. Whatever the person then accepts goes through
 * the ordinary server actions, with their permissions, history and webhooks.
 */
import "server-only";

import { requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

import { type AiRefusal, aiAccess, reserveAiRequest } from "./access";
import { type AiDeps, aiGenerate, aiGenerateJson } from "./client";
import { recordSuggestion } from "./suggestions";
import type { AiFailureReason, AiRequest, AiResult, AiTask, JsonSchema } from "./types";

export interface AiRunSubject {
  entityType?: string | null;
  entityId?: string | null;
}

export type AiRun<T> =
  | { ok: true; suggestionId: string; value: T; truncated: boolean }
  | {
      ok: false;
      reason: AiRefusal | AiFailureReason;
      /** Set when the call was made and logged; null when it was refused before. */
      suggestionId: string | null;
    };

async function guarded<T>(
  task: AiTask,
  subject: AiRunSubject,
  call: () => Promise<{ result: AiResult; value: T | null; shown: string | null }>,
): Promise<AiRun<T>> {
  // Using the copilot means acting on records: a read-only member does not.
  const actor = await requireCapability("record:write");
  const access = await aiAccess(task);
  if (!access.ok) return { ok: false, reason: access.refusal, suggestionId: null };
  if (!(await reserveAiRequest(access.tenantId))) return { ok: false, reason: "limit", suggestionId: null };

  const { result, value, shown } = await call();
  const suggestionId = await recordSuggestion(await getDb(), {
    task,
    userId: actor.userId,
    entityType: subject.entityType,
    entityId: subject.entityId,
    result,
    shown,
  });
  if (!result.ok || value === null) {
    const reason = result.ok ? "output" : result.reason;
    console.warn(`[ai] ${task} failed: ${reason}${result.ok ? "" : ` — ${result.message}`}`);
    return { ok: false, reason, suggestionId };
  }
  return { ok: true, suggestionId, value, truncated: result.truncated };
}

/** A task whose answer is text: a draft, a summary, a briefing. */
export function runAiTask(
  task: AiTask,
  request: AiRequest,
  subject: AiRunSubject = {},
  deps?: AiDeps,
): Promise<AiRun<string>> {
  return guarded(task, subject, async () => {
    const result = await aiGenerate(task, request, deps);
    return { result, value: result.ok ? result.text : null, shown: result.ok ? result.text : null };
  });
}

/** A task whose answer is data checked against a schema: extraction, classification. */
export function runAiJsonTask<T>(
  task: AiTask,
  request: Omit<AiRequest, "output"> & { schema: JsonSchema },
  parse: (value: unknown) => T | null,
  subject: AiRunSubject = {},
  deps?: AiDeps,
): Promise<AiRun<T>> {
  return guarded(task, subject, async () => {
    const json = await aiGenerateJson(task, request, parse, deps);
    if (json.ok) {
      const text = JSON.stringify(json.value);
      const result: AiResult = {
        ok: true,
        text,
        truncated: false,
        usage: json.usage,
        provider: json.provider,
        model: json.model,
      };
      return { result, value: json.value, shown: text };
    }
    return { result: json, value: null, shown: null };
  });
}

/**
 * What kind of contact a task is, and what can be said about it once it is done.
 *
 * ⚠️⚠️ One call used to be three records: a task to remember it, an activity to say it
 * happened, and often a comment for the colleague. Salespeople working sixty records a
 * day skip steps, and the CRM empties. So a task carries its kind, and completing it
 * *is* recording it: the activity it becomes takes the kind, the outcome and the note,
 * and the next step is planned in the same gesture (updateTaskStatus).
 *
 * Pure: imported by the server action and by the dialog.
 */

export const TASK_TYPES = ["call", "email", "meeting", "todo"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === "string" && (TASK_TYPES as readonly string[]).includes(v);
}

/** Old rows and unknown values read as "todo": nothing said otherwise. */
export function taskTypeOf(v: unknown): TaskType {
  return isTaskType(v) ? v : "todo";
}

/** The activity a completed task becomes. A to-do is a note: nobody was contacted. */
export function activityTypeFor(type: TaskType): "call" | "email" | "meeting" | "note" {
  return type === "todo" ? "note" : type;
}

export const OUTCOMES = {
  call: ["reached", "no_answer", "voicemail"],
  email: ["sent"],
  meeting: ["held", "no_show"],
  todo: ["done"],
} as const satisfies Record<TaskType, readonly string[]>;

export type Outcome = (typeof OUTCOMES)[TaskType][number];

/** An outcome belongs to the kind of task it describes; anything else is dropped, not stored. */
export function outcomeFor(type: TaskType, outcome: unknown): Outcome | null {
  const allowed: readonly string[] = OUTCOMES[type];
  return typeof outcome === "string" && allowed.includes(outcome) ? (outcome as Outcome) : null;
}

/**
 * ⚠️ An attempt that did not reach anybody is not finished business: a call nobody
 * answered needs another call. The dialog proposes the same kind again for these.
 */
export function needsRetry(outcome: Outcome | null): boolean {
  return outcome === "no_answer" || outcome === "voicemail" || outcome === "no_show";
}

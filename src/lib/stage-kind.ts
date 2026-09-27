/**
 * What a pipeline stage means: a place where deals are still being worked, or the
 * column a deal lands in when it is won or lost.
 *
 * ⚠️ The kind is what closes a deal. Dragging a card into the won column, picking it in
 * the form, or converting a quote into an order all read `isWon` / `isLost` to decide
 * the deal's status (reconcileStageAndStatus, updateDealStage). A pipeline with two won
 * columns makes "move it to won" ambiguous, and changing the kind of a column with deals
 * in it would leave every one of them with a status its column contradicts — so both
 * are refused here rather than repaired later.
 */

export type StageKind = "open" | "won" | "lost";

export const STAGE_KINDS: readonly StageKind[] = ["open", "won", "lost"];

type Flags = { isWon: boolean | null; isLost: boolean | null };

export function kindOf(stage: Flags): StageKind {
  if (stage.isWon) return "won";
  if (stage.isLost) return "lost";
  return "open";
}

export function flagsOf(kind: StageKind): { isWon: boolean; isLost: boolean } {
  return { isWon: kind === "won", isLost: kind === "lost" };
}

export type StageKindRefusal = "anotherWon" | "anotherLost" | "hasDeals";

/**
 * Whether `stageId` (null for a stage not created yet) may take `kind`.
 * `dealsInStage` is only consulted when the kind actually changes.
 */
export function checkStageKind(
  stages: ({ id: string } & Flags)[],
  stageId: string | null,
  kind: StageKind,
  dealsInStage: number,
): StageKindRefusal | null {
  const current = stageId ? stages.find((s) => s.id === stageId) : undefined;
  if (current && kindOf(current) === kind) return null;

  if (kind !== "open" && stages.some((s) => s.id !== stageId && kindOf(s) === kind)) {
    return kind === "won" ? "anotherWon" : "anotherLost";
  }
  if (current && dealsInStage > 0) return "hasDeals";
  return null;
}

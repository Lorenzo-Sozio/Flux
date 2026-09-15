/**
 * Handing new records out in turn among a set of people.
 *
 * Used by the automation action `assign_owner`. Pure, so the rules below can be
 * tested without a workspace; the turn itself comes from the atomic counter in
 * `src/lib/document-counter.ts`, which is what makes two leads arriving together
 * go to two different people instead of both reading "whose turn is it" and
 * getting the same answer.
 *
 * ⚠️ Three rules, each one there to prevent an assignment that looks correct:
 *
 *   * **Only current members.** A rule configured months ago still lists the
 *     salesperson who left. Handing them a lead is a lead nobody works, and it
 *     would sit in their name looking assigned.
 *   * **Each person once, in the order configured.** A name listed twice by
 *     mistake would quietly receive twice the leads.
 *   * **The turn counts every assignment, not every person.** When somebody is
 *     added or removed the rotation shifts by one position and carries on — it
 *     does not restart at the top of the list and hand the next several leads
 *     to whoever is first.
 */

/** The sequence a rule's rotation advances through. One per rule. */
export function roundRobinScope(ruleId: string): string {
  return `round-robin:${ruleId}`;
}

/** The people listed on the rule who are still members, once each, in the listed order. */
export function eligibleInOrder(listed: readonly string[], members: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of listed) {
    if (!id || seen.has(id) || !members.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Whose turn it is, for turn number `turn` (the counter starts at 1).
 *
 * Throws on an empty list rather than returning `undefined`: an owner of
 * `undefined` written to a record is an unassigned lead that the rule's log
 * reports as assigned.
 */
export function pickInTurn(eligible: readonly string[], turn: number): string {
  if (eligible.length === 0) throw new Error("Nobody is eligible to receive this record.");
  if (!Number.isInteger(turn) || turn < 1) throw new Error(`Invalid turn ${turn}`);
  return eligible[(turn - 1) % eligible.length];
}

/** Entity types that have an owner an automation may set. */
export const OWNED_ENTITIES = ["lead", "contact", "company", "deal"] as const;
export type OwnedEntity = (typeof OWNED_ENTITIES)[number];

export function isOwnedEntity(entityType: string): entityType is OwnedEntity {
  return (OWNED_ENTITIES as readonly string[]).includes(entityType);
}

/**
 * order-status.ts — the order flow, in one place.
 *
 * An order moved only through a dropdown, which asks the user to remember what
 * comes next and lets them pick anything at all, including going backwards from
 * completed. The flow itself is short and never in doubt, so the common move is
 * worth a button rather than a menu.
 *
 * Pure, so the page, the actions and any future automation read the same rule
 * instead of each carrying their own copy.
 */

export type OrderStatus = "draft" | "processing" | "completed" | "cancelled";

/**
 * The path an order takes when nothing goes wrong.
 *
 * `cancelled` is deliberately not on it: it is somewhere an order is sent, never
 * somewhere it arrives by carrying on.
 */
export const ORDER_FLOW: OrderStatus[] = ["draft", "processing", "completed"];

/** An order here is finished with. Nothing advances out of it. */
export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * The next step, or null when there is not one.
 *
 * Null for `completed` and `cancelled`, and for anything unrecognised — a status
 * this module does not know about is not one it should be guessing a successor
 * for.
 */
export function nextStatus(status: string): OrderStatus | null {
  const at = ORDER_FLOW.indexOf(status as OrderStatus);
  if (at === -1 || at === ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[at + 1];
}

/**
 * What the button that advances the order should say.
 *
 * It names the destination rather than the movement. "Advance" tells the user
 * that something will change and not what to; "Start processing" is a sentence
 * they can agree or disagree with before they click.
 */
export function advanceLabel(status: string): string | null {
  switch (nextStatus(status)) {
    case "processing":
      return "Start processing";
    case "completed":
      return "Mark completed";
    default:
      return null;
  }
}

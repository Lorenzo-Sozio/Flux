import type { SdiStatus } from "./types";

/**
 * The rules about SDI statuses that do not depend on any intermediary: pure, so the screens,
 * the job and the tests agree.
 */

/** Statuses the job keeps asking about. */
export function stillOpen(status: SdiStatus | null, isPublicAdministration: boolean): boolean {
  if (status === "pending") return true;
  // A public administration answers after delivery (accepted, refused, or 15 days of silence).
  return status === "delivered" && isPublicAdministration;
}

/** A status after which the invoice may be handed over again: nothing valid reached SDI. */
export function maySend(status: SdiStatus | null): boolean {
  return status === null || status === "send_failed" || status === "error";
}

/** Statuses somebody has to act on: the invoice list's "SDI problems" filter reads the same list. */
export const SDI_ATTENTION = ["send_failed", "error", "rejected", "not_delivered", "refused"] as const;

export function needsAttention(status: SdiStatus | null): boolean {
  return (SDI_ATTENTION as readonly string[]).includes(status ?? "");
}

/** A recipient code of six characters is a public administration's (codice univoco ufficio). */
export function isPublicAdministration(customer: { sdiCode?: string | null } | null | undefined): boolean {
  return (customer?.sdiCode ?? "").trim().length === 6;
}

/** How long the job keeps asking about one invoice: past this, a person looks. */
export const STATUS_WATCH_DAYS = 30;

/** The last status an intermediary reports may not go backwards: a late "pending" does not undo "delivered". */
const RANK: Record<SdiStatus, number> = {
  sending: 0,
  send_failed: 0,
  pending: 1,
  error: 2,
  rejected: 2,
  not_delivered: 3,
  delivered: 3,
  accepted: 4,
  refused: 4,
  expired: 4,
  sent_manually: 4,
};

export function laterStatus(current: SdiStatus | null, reported: SdiStatus): boolean {
  return current === null || RANK[reported] >= RANK[current];
}

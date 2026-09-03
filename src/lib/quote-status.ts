/**
 * quote-status.ts — the states a quote can be in, and the moves between them.
 *
 * Two things were missing (audit rilievo D-03):
 *
 *  1. Approval and rejection both returned the quote to `draft`. An approved quote
 *     and a rejected one were therefore the same record, distinguishable only by a
 *     note, and nothing stopped the owner sending either. The approval step existed
 *     without approving anything — and its presence discouraged adding a real one.
 *
 *  2. `updateQuoteAction` accepted any status directly, so `sent` could be set from
 *     anywhere, skipping the flow entirely. A quote could also go from `accepted`
 *     back to `draft`, rewriting `acceptedAt` on the way.
 *
 * The transitions below are the whole policy, in one readable table.
 */

export const QUOTE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "converted",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export function isQuoteStatus(value: string): value is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

/**
 * Where each status may go next.
 *
 * `expired` is deliberately not a dead end: a lapsed quote can be reopened as a
 * draft and re-issued, which is what actually happens when a customer comes back.
 */
const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["pending_approval", "approved", "sent"],
  pending_approval: ["approved", "draft"],
  approved: ["sent", "draft"],
  sent: ["viewed", "accepted", "declined", "expired"],
  viewed: ["accepted", "declined", "expired"],
  accepted: ["converted"],
  declined: ["draft"],
  expired: ["draft"],
  converted: [],
};

export function canTransition(from: string, to: string): boolean {
  if (!isQuoteStatus(from) || !isQuoteStatus(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Why a transition was refused, in words the person reading it can act on. */
export function transitionError(from: string, to: string): string {
  if (!isQuoteStatus(to)) return `"${to}" is not a quote status.`;
  if (from === "converted") return "This quote has already become an order and can no longer change.";
  if (from === "accepted" && to !== "converted") return "The customer has accepted this quote; it cannot be changed.";
  if (to === "sent") return "A quote can only be sent from draft or after approval.";
  return `A quote cannot go from "${from}" to "${to}".`;
}

// ─── Approval policy ──────────────────────────────────────────────────────────

/**
 * When approval is compulsory.
 *
 * Discretionary approval is approval nobody asks for. A threshold turns it into
 * something that happens on its own, which is the only version a sales team
 * actually uses. Both values are optional per workspace; the defaults ask for
 * approval on the discounts a manager would want to see anyway.
 */
export interface ApprovalPolicy {
  /** Header discount, in percent, above which approval is required. */
  maxDiscountPercent: number;
  /** Document total above which approval is required. Zero disables the check. */
  maxTotalAmount: number;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  maxDiscountPercent: 20,
  maxTotalAmount: 0,
};

/** Reads the policy out of the workspace settings blob, falling back to defaults. */
export function approvalPolicyFrom(settingsJson: string | null | undefined): ApprovalPolicy {
  if (!settingsJson) return DEFAULT_APPROVAL_POLICY;
  try {
    const parsed = JSON.parse(settingsJson) as { quoteApproval?: Partial<ApprovalPolicy> };
    return {
      maxDiscountPercent: parsed.quoteApproval?.maxDiscountPercent ?? DEFAULT_APPROVAL_POLICY.maxDiscountPercent,
      maxTotalAmount: parsed.quoteApproval?.maxTotalAmount ?? DEFAULT_APPROVAL_POLICY.maxTotalAmount,
    };
  } catch {
    return DEFAULT_APPROVAL_POLICY;
  }
}

/**
 * Whether this quote needs a signature before it can leave, and why.
 * Returns null when it may be sent as it stands.
 */
export function approvalRequiredReason(
  quote: { discountPercent?: string | number | null; totalAmount?: string | number | null },
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): string | null {
  const discount = Number(quote.discountPercent ?? 0);
  const total = Number(quote.totalAmount ?? 0);

  if (policy.maxDiscountPercent > 0 && discount > policy.maxDiscountPercent) {
    return `A discount of ${discount}% is above the ${policy.maxDiscountPercent}% this workspace allows without approval.`;
  }
  if (policy.maxTotalAmount > 0 && total > policy.maxTotalAmount) {
    return `A total of ${total} is above the ${policy.maxTotalAmount} this workspace allows without approval.`;
  }
  return null;
}

// ─── Presentation ─────────────────────────────────────────────────────────────

/**
 * Badge styling per status. Labels are looked up through next-intl by the
 * components; they used to be hardcoded here and mixed English with Italian in
 * the same object (audit rilievo U-08).
 */
export const QUOTE_STATUS_CONFIG: Record<QuoteStatus, { labelKey: string; className: string }> = {
  draft: { labelKey: "draft", className: "border-slate-300 text-slate-600" },
  pending_approval: {
    labelKey: "pending_approval",
    className: "border-orange-300 text-orange-600 bg-orange-50",
  },
  approved: { labelKey: "approved", className: "border-cyan-300 text-cyan-700 bg-cyan-50" },
  sent: { labelKey: "sent", className: "border-blue-300 text-blue-600 bg-blue-50" },
  viewed: { labelKey: "viewed", className: "border-violet-300 text-violet-600 bg-violet-50" },
  accepted: { labelKey: "accepted", className: "border-green-300 text-green-600 bg-green-50" },
  declined: { labelKey: "declined", className: "border-red-300 text-red-600 bg-red-50" },
  expired: { labelKey: "expired", className: "border-amber-300 text-amber-600 bg-amber-50" },
  converted: { labelKey: "converted", className: "border-teal-300 text-teal-600 bg-teal-50" },
};

/** English fallbacks, for the few places that render without a translator. */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  converted: "Converted",
};

/** Badge config for any stored value, falling back to draft for unknown ones. */
export function quoteStatusConfig(status: string): { labelKey: string; className: string } {
  return isQuoteStatus(status) ? QUOTE_STATUS_CONFIG[status] : QUOTE_STATUS_CONFIG.draft;
}

/** English label for any stored value. */
export function quoteStatusLabel(status: string): string {
  return isQuoteStatus(status) ? QUOTE_STATUS_LABELS[status] : QUOTE_STATUS_LABELS.draft;
}

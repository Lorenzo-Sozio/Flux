/**
 * The qualification steps, in the order a lead moves through them.
 *
 * ⚠️ In a module of its own, not beside the path component: that file is
 * "use client", and a value exported from a client module reaches a server
 * component as a client reference, not as the array. `LEAD_STEPS.includes`
 * then threw "is not a function" and took the whole lead page down.
 */
export const LEAD_STEPS = ["new", "contacting", "engaged", "qualified"] as const;

export type LeadStep = (typeof LEAD_STEPS)[number];

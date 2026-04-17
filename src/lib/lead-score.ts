/**
 * Lead Score calculation — deterministic, 0–100 scale.
 * Called after create/update; result is persisted to DB.
 *
 * Tiers (for badge display):
 *   0–29  → Cold (slate)
 *  30–59  → Warm (amber)
 *  60–79  → Hot  (orange)
 *  80–100 → Very Hot (red)
 */

interface LeadScoreInput {
  status?: string | null;
  rating?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  companyName?: string | null;
  companyId?: string | null; // contacts
  linkedinUrl?: string | null;
  website?: string | null;
  marketingConsent?: boolean | null;
}

export function computeLeadScore(data: LeadScoreInput): number {
  let score = 0;

  // Status points (leads)
  const statusPoints: Record<string, number> = {
    qualified: 40,
    engaged: 30,
    contacting: 20,
    new: 10,
    unqualified: 0,
  };
  if (data.status && statusPoints[data.status] !== undefined) {
    score += statusPoints[data.status];
  }

  // Status points (contacts)
  if (data.status === "active") score += 20;
  if (data.status === "inactive") score += 0;

  // Rating points (leads only)
  const ratingPoints: Record<string, number> = {
    hot: 30,
    warm: 15,
    cold: 0,
  };
  if (data.rating && ratingPoints[data.rating] !== undefined) {
    score += ratingPoints[data.rating];
  }

  // Data completeness
  if (data.email) score += 10;
  if (data.phone || data.mobile) score += 5;
  if (data.companyName || data.companyId) score += 5;
  if (data.linkedinUrl) score += 5;
  if (data.website) score += 3;
  if (data.marketingConsent) score += 2;

  return Math.min(100, Math.max(0, score));
}

export type ScoreTier = "cold" | "warm" | "hot" | "very_hot";

export function getScoreTier(score: number): ScoreTier {
  if (score >= 80) return "very_hot";
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "cold";
}

export const SCORE_TIER_CONFIG: Record<ScoreTier, { label: string; className: string }> = {
  cold: { label: "Cold", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  warm: { label: "Warm", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  hot: { label: "Hot", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  very_hot: { label: "Very Hot", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

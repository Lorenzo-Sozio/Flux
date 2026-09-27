/**
 * The first-run steps, in order — alone in a file because the home card imports it, and the
 * module that reads them (src/lib/onboarding.ts) pulls in the database schema.
 */
export const ONBOARDING_STEPS = ["company", "team", "contacts", "stages", "email"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  steps: Record<OnboardingStep, boolean>;
  done: number;
  sample: boolean;
  dismissed: boolean;
}

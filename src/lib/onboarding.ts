import { inArray, sql } from "drizzle-orm";

import { workspaceSettings } from "@/db/schema";
import { ONBOARDING_STEPS, type OnboardingState, type OnboardingStep } from "@/lib/onboarding-steps";
import { SAMPLE_PREFIX } from "@/lib/sample-data";

export { ONBOARDING_STEPS, type OnboardingState, type OnboardingStep };

/**
 * The first steps of a new workspace, each ticked by the data rather than by hand (§13.2):
 * a box somebody ticks says they clicked it, a box the data ticks says it is done.
 *
 * - **company** — the legal details on the invoicing profile, or a logo for the documents;
 * - **team** — somebody else is in the workspace, or has been invited;
 * - **contacts** — a contact or a company that is not sample data;
 * - **stages** — a stage has been edited since it was created, or somebody said the
 *   defaults are right: the one step where "looked at it and it is fine" is a real answer;
 * - **email** — a sending account is configured, or an email has been archived by Bcc.
 *
 * ⚠️ One statement for the four that live in this database. The home page is the screen
 * everybody opens every morning.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export const ONBOARDING_KEYS = {
  dismissed: "onboarding.dismissed",
  stagesReviewed: "onboarding.stagesReviewed",
} as const;

/** The placeholder a fresh `email_settings` row carries: not an address anybody configured. */
const PLACEHOLDER_FROM = "noreply@yourdomain.com";

export async function readOnboarding(
  db: AnyDb,
  team: { members: number; pendingInvitations: number },
): Promise<OnboardingState> {
  const prefix = `${SAMPLE_PREFIX}%`;
  const [facts, settings] = await Promise.all([
    db
      .execute(sql`
        select
          (exists (select 1 from invoice_issuer where coalesce(legal_name, '') <> '' or coalesce(vat_number, '') <> '')
            or exists (select 1 from workspace_setting where key = 'brand.logo')) as company,
          (exists (select 1 from contact where id not like ${prefix})
            or exists (select 1 from company where id not like ${prefix})) as contacts,
          exists (select 1 from pipeline_stage where updated_at > created_at + interval '1 minute') as stages,
          (exists (select 1 from email_settings
                    where (coalesce(resend_api_key, '') <> '' or coalesce(smtp_host, '') <> '')
                      and from_email <> ${PLACEHOLDER_FROM})
            or exists (select 1 from activity where message_id is not null)) as email,
          exists (select 1 from deal where id like ${prefix}) as sample`)
      .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] ?? {}),
    db
      .select({ key: workspaceSettings.key, value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(inArray(workspaceSettings.key, [ONBOARDING_KEYS.dismissed, ONBOARDING_KEYS.stagesReviewed])),
  ]);
  const flag = (key: string) =>
    settings.some((s: { key: string; value: unknown }) => s.key === key && s.value === true);

  const steps: Record<OnboardingStep, boolean> = {
    company: Boolean(facts.company),
    team: team.members > 1 || team.pendingInvitations > 0,
    contacts: Boolean(facts.contacts),
    stages: Boolean(facts.stages) || flag(ONBOARDING_KEYS.stagesReviewed),
    email: Boolean(facts.email),
  };
  return {
    steps,
    done: ONBOARDING_STEPS.filter((s) => steps[s]).length,
    sample: Boolean(facts.sample),
    dismissed: flag(ONBOARDING_KEYS.dismissed),
  };
}

/** Shown while there is a step to do and nobody has put it away — and always while sample data is in. */
export function showOnboarding(state: OnboardingState): boolean {
  return state.sample || (!state.dismissed && state.done < ONBOARDING_STEPS.length);
}

export async function setOnboardingFlag(db: AnyDb, key: string, value: boolean): Promise<void> {
  await db
    .insert(workspaceSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: workspaceSettings.key, set: { value, updatedAt: sql`now()` } });
}

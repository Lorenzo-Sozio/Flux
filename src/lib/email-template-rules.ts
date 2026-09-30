/**
 * What a one-to-one email template is, and who may do what with it — without the database, so a
 * client component can import it. ⚠️ Importing src/lib/email-templates.ts from the browser would
 * carry the schema into the client bundle, which the Worker's size budget cannot spare.
 */

export type TemplateKind = "campaign" | "personal";

/** What a one-to-one template is for: the menu groups and filters by it. */
export const PERSONAL_CATEGORIES = [
  "intro",
  "followup",
  "meeting",
  "quote",
  "deal",
  "order",
  "contract",
  "invoice",
  "support",
  "thanks",
  "other",
] as const;
export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number];

export function isPersonalCategory(value: unknown): value is PersonalCategory {
  return typeof value === "string" && (PERSONAL_CATEGORIES as readonly string[]).includes(value);
}

interface Owned {
  kind: string;
  ownerId: string | null;
  isPublic: boolean | null;
}

/** A campaign template everybody sees; a personal one its owner, or everybody once shared. */
export function canSeeTemplate(tpl: Owned, userId: string): boolean {
  if (tpl.kind !== "personal") return true;
  return tpl.ownerId === userId || tpl.isPublic === true;
}

/**
 * Who may change or delete a personal template: its owner, and — for one shared with the team —
 * whoever may act on everybody's records (`record:manageAny`). Campaign templates are Marketing's.
 */
export function canEditTemplate(tpl: Owned, actor: { userId: string; manageAny: boolean }): boolean {
  if (tpl.kind !== "personal") return false;
  if (tpl.ownerId === actor.userId) return true;
  return tpl.isPublic === true && actor.manageAny;
}

export interface ComposerTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  kind: TemplateKind;
  category: string;
  isPublic: boolean;
  mine: boolean;
}

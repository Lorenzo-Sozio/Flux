/**
 * Email templates for one-to-one emails: the text a salesperson starts from instead of writing
 * the whole email every time (migration 0070).
 *
 * Two kinds in one table, because they are one thing to the person choosing: a subject and a
 * body with the recipient's fields in it.
 * - **campaign** — made in Marketing, often in the designer, sent by campaigns and sequences;
 *   everybody sees them, as before.
 * - **personal** — made in Settings → Email templates by whoever writes to customers, without
 *   the marketing module. ⚠️ Private to its owner until shared with the team.
 *
 * Who may change a template is decided here, once, and read by the actions and the screens.
 */
import { and, asc, desc, eq, or, sql } from "drizzle-orm";

import { emailTemplates, users } from "@/db/schema";

import type { ComposerTemplate } from "./email-template-rules";

export {
  type ComposerTemplate,
  canEditTemplate,
  canSeeTemplate,
  isPersonalCategory,
  PERSONAL_CATEGORIES,
  type PersonalCategory,
  type TemplateKind,
} from "./email-template-rules";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** The same rule as `canSeeTemplate`, as a condition. */
function visibleTo(userId: string) {
  return or(
    eq(emailTemplates.kind, "campaign"),
    and(eq(emailTemplates.kind, "personal"), or(eq(emailTemplates.ownerId, userId), eq(emailTemplates.isPublic, true))),
  );
}

/**
 * What the email dialog offers: one-to-one templates first — the ones used most on top — then
 * the campaign ones.
 */
export async function listComposerTemplates(db: AnyDb, userId: string): Promise<ComposerTemplate[]> {
  const rows: {
    id: string;
    name: string;
    subject: string;
    body: string;
    kind: string;
    category: string;
    isPublic: boolean | null;
    ownerId: string | null;
  }[] = await db
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      subject: emailTemplates.subject,
      body: emailTemplates.body,
      kind: emailTemplates.kind,
      category: emailTemplates.category,
      isPublic: emailTemplates.isPublic,
      ownerId: emailTemplates.ownerId,
    })
    .from(emailTemplates)
    .where(visibleTo(userId))
    .orderBy(
      sql`case when ${emailTemplates.kind} = 'personal' then 0 else 1 end`,
      desc(emailTemplates.useCount),
      asc(emailTemplates.name),
    );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    subject: r.subject,
    body: r.body,
    kind: r.kind === "personal" ? "personal" : "campaign",
    category: r.category,
    isPublic: r.isPublic === true,
    mine: r.ownerId === userId,
  }));
}

export interface PersonalTemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  isPublic: boolean;
  ownerId: string | null;
  ownerName: string | null;
  useCount: number;
  lastUsedAt: Date | null;
  updatedAt: Date;
}

/** The one-to-one templates this person can see, for the page that manages them. */
export async function listPersonalTemplates(db: AnyDb, userId: string): Promise<PersonalTemplateRow[]> {
  const rows = await db
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      subject: emailTemplates.subject,
      body: emailTemplates.body,
      category: emailTemplates.category,
      isPublic: emailTemplates.isPublic,
      ownerId: emailTemplates.ownerId,
      ownerName: users.name,
      useCount: emailTemplates.useCount,
      lastUsedAt: emailTemplates.lastUsedAt,
      updatedAt: emailTemplates.updatedAt,
    })
    .from(emailTemplates)
    .leftJoin(users, eq(emailTemplates.ownerId, users.id))
    .where(
      and(
        eq(emailTemplates.kind, "personal"),
        or(eq(emailTemplates.ownerId, userId), eq(emailTemplates.isPublic, true)),
      ),
    )
    .orderBy(asc(emailTemplates.name));
  return rows.map((r: PersonalTemplateRow & { isPublic: boolean | null }) => ({ ...r, isPublic: r.isPublic === true }));
}

/** A template was sent from a record: counted, so the ones in use come first. */
export async function recordTemplateUse(db: AnyDb, id: string): Promise<void> {
  await db
    .update(emailTemplates)
    .set({ useCount: sql`${emailTemplates.useCount} + 1`, lastUsedAt: new Date() })
    .where(eq(emailTemplates.id, id));
}

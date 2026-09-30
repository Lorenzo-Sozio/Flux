"use server";

/**
 * One-to-one email templates (src/lib/email-templates.ts): made by whoever writes to customers,
 * private until shared, offered in the email dialog.
 *
 * ⚠️ Every export here is an endpoint any signed-in browser can call. Each checks the
 * capability, and a change checks `canEditTemplate` against the row as it is in the database,
 * never as the browser describes it.
 */
import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { emailTemplates } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { STARTER_FIELDS, STARTER_TEMPLATES, starterBodyHtml } from "@/lib/email-template-starters";
import {
  type ComposerTemplate,
  canEditTemplate,
  listComposerTemplates,
  listPersonalTemplates,
  PERSONAL_CATEGORIES,
  type PersonalTemplateRow,
} from "@/lib/email-templates";
import { serverT } from "@/lib/i18n-server";
import { can } from "@/lib/permissions";
import { getDb } from "@/lib/tenant-context";

type Failure = { ok: false; error: string };

const PATH = "/dashboard/settings/email-templates";

const TemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(PERSONAL_CATEGORIES),
  subject: z.string().trim().min(1).max(300),
  body: z
    .string()
    .max(100_000)
    .refine((html) => html.replace(/<[^>]+>/g, "").trim().length > 0),
  isPublic: z.boolean(),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

async function fail(key: string): Promise<Failure> {
  return { ok: false, error: (await serverT("emailTemplates.errors"))(key) };
}

/** What the email dialog offers this person. */
export async function getComposerTemplates(): Promise<ComposerTemplate[]> {
  const actor = await requireCapability("record:read");
  return listComposerTemplates(await getDb(), actor.userId);
}

/** The one-to-one templates this person sees, and which of them they may change. */
export async function getPersonalTemplates(): Promise<(PersonalTemplateRow & { editable: boolean })[]> {
  const actor = await requireCapability("record:read");
  const manageAny = can(actor, "record:manageAny");
  const rows = await listPersonalTemplates(await getDb(), actor.userId);
  return rows.map((r) => ({
    ...r,
    editable:
      can(actor, "record:write") && canEditTemplate({ kind: "personal", ...r }, { userId: actor.userId, manageAny }),
  }));
}

/** Creates a template, or changes one the caller may change. */
export async function saveTemplateAction(
  input: TemplateInput & { id?: string },
): Promise<{ ok: true; id: string } | Failure> {
  const actor = await requireCapability("record:write");
  const parsed = TemplateInput.safeParse(input);
  if (!parsed.success) return fail("invalid");
  const db = await getDb();
  const values = { ...parsed.data, kind: "personal" as const, isHtml: true, updatedAt: new Date() };

  if (input.id) {
    const [existing] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, input.id));
    if (!existing) return fail("notFound");
    if (!canEditTemplate(existing, { userId: actor.userId, manageAny: can(actor, "record:manageAny") })) {
      return fail("forbidden");
    }
    await db.update(emailTemplates).set(values).where(eq(emailTemplates.id, input.id));
    revalidatePath(PATH);
    return { ok: true, id: input.id };
  }

  const id = crypto.randomUUID();
  await db.insert(emailTemplates).values({ ...values, id, ownerId: actor.userId });
  revalidatePath(PATH);
  return { ok: true, id };
}

export async function deleteTemplateAction(id: string): Promise<{ ok: true } | Failure> {
  const actor = await requireCapability("record:write");
  const db = await getDb();
  const [existing] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
  if (!existing) return fail("notFound");
  if (!canEditTemplate(existing, { userId: actor.userId, manageAny: can(actor, "record:manageAny") })) {
    return fail("forbidden");
  }
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * The basic templates — one for each thing the CRM keeps that a customer is written to about
 * (src/lib/email-template-starters.ts) — in the person's language, shared with the team, as a
 * starting point to edit.
 *
 * ⚠️ Adds only the ones missing: a template of the same name the person can already see is left
 * alone, so pressing it again after an update brings in the new ones without doubling the old.
 */
export async function createStarterTemplatesAction(): Promise<{ ok: true; created: number } | Failure> {
  const actor = await requireCapability("record:write");
  const t = await serverT("emailTemplates.starters");
  const db = await getDb();
  const existing = new Set((await listPersonalTemplates(db, actor.userId)).map((tpl) => tpl.name.trim().toLowerCase()));
  const missing = STARTER_TEMPLATES.filter((s) => !existing.has(t(`${s.key}.name`).trim().toLowerCase()));
  if (missing.length === 0) return { ok: true, created: 0 };

  await db.insert(emailTemplates).values(
    missing.map((s) => ({
      id: crypto.randomUUID(),
      kind: "personal",
      category: s.category,
      name: t(`${s.key}.name`),
      subject: t(`${s.key}.subject`, STARTER_FIELDS),
      body: starterBodyHtml(t(`${s.key}.body`, STARTER_FIELDS)),
      isHtml: true,
      isPublic: true,
      ownerId: actor.userId,
    })),
  );
  revalidatePath(PATH);
  return { ok: true, created: missing.length };
}

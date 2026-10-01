"use server";

import { revalidatePath } from "next/cache";

import { and, eq } from "drizzle-orm";

import { customFieldDefinitions, customFieldValues } from "@/db/schema";
import { requireAdminAccess, requireCapability, requireWriteAccess } from "@/lib/auth-guard";
import { assertCanSee } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

export type FieldType = "text" | "number" | "date" | "select" | "multiselect" | "boolean" | "url";
export type EntityType = "contact" | "lead" | "company" | "deal";

const ENTITY_TYPES: readonly string[] = ["contact", "lead", "company", "deal"];

/** The record the values hang off must be one the person sees; an unknown type is refused outright. */
async function assertEntityVisible(entityType: EntityType, entityId: string): Promise<void> {
  if (!ENTITY_TYPES.includes(entityType)) throw new Error("Unknown entity type");
  await assertCanSee(entityType, entityId);
}

// ─── Field Definitions ───────────────────────────────────────────────────────

export async function getCustomFieldDefinitions(entityType?: EntityType) {
  await requireCapability("record:read");
  const db = await getDb();
  const query = db.select().from(customFieldDefinitions);
  if (entityType) {
    return query.where(eq(customFieldDefinitions.entityType, entityType));
  }
  return query;
}

export async function createCustomFieldDefinition(data: {
  name: string;
  slug: string;
  entityType: EntityType;
  fieldType: FieldType;
  options?: string[];
  isRequired?: boolean;
  ownerId?: string;
}) {
  await requireAdminAccess();
  const db = await getDb();
  const [field] = await db
    .insert(customFieldDefinitions)
    .values({
      ...data,
      options: data.options ? JSON.stringify(data.options) : null,
    })
    .returning();
  revalidatePath("/dashboard/settings/custom-fields");
  return field;
}

export async function updateCustomFieldDefinition(
  id: string,
  data: Partial<{
    name: string;
    options: string[];
    isRequired: boolean;
    order: number;
  }>,
) {
  await requireAdminAccess();
  const db = await getDb();
  const [updated] = await db
    .update(customFieldDefinitions)
    .set({
      ...data,
      options: data.options ? JSON.stringify(data.options) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(customFieldDefinitions.id, id))
    .returning();
  revalidatePath("/dashboard/settings/custom-fields");
  return updated;
}

export async function deleteCustomFieldDefinition(id: string) {
  await requireAdminAccess();
  const db = await getDb();
  // Cascade deletes values too (FK constraint)
  await db.delete(customFieldDefinitions).where(eq(customFieldDefinitions.id, id));
  revalidatePath("/dashboard/settings/custom-fields");
}

// ─── Field Values ────────────────────────────────────────────────────────────

export async function getCustomFieldValues(entityType: EntityType, entityId: string) {
  await requireCapability("record:read");
  await assertEntityVisible(entityType, entityId);
  const db = await getDb();
  return await db
    .select()
    .from(customFieldValues)
    .where(and(eq(customFieldValues.entityType, entityType), eq(customFieldValues.entityId, entityId)));
}

export async function upsertCustomFieldValue(data: {
  fieldId: string;
  entityType: EntityType;
  entityId: string;
  value: string;
}) {
  await requireWriteAccess();
  await assertEntityVisible(data.entityType, data.entityId);
  await writeCustomFieldValue(data);
}

async function writeCustomFieldValue(data: {
  fieldId: string;
  entityType: EntityType;
  entityId: string;
  value: string;
}) {
  const db = await getDb();
  // Try update first
  const existing = await db
    .select({ id: customFieldValues.id })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.fieldId, data.fieldId), eq(customFieldValues.entityId, data.entityId)));

  if (existing.length > 0) {
    await db
      .update(customFieldValues)
      .set({ value: data.value, updatedAt: new Date() })
      .where(and(eq(customFieldValues.fieldId, data.fieldId), eq(customFieldValues.entityId, data.entityId)));
  } else {
    await db.insert(customFieldValues).values({
      ...data,
    });
  }
}

/** Writes several custom fields of one record at once, checking the record once. */
export async function bulkUpsertCustomFieldValues(
  entityType: EntityType,
  entityId: string,
  values: Record<string, string>,
) {
  await requireWriteAccess();
  await assertEntityVisible(entityType, entityId);
  for (const [fieldId, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      await writeCustomFieldValue({ fieldId, entityType, entityId, value: String(value) });
    }
  }
}

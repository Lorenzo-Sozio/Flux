"use server";

import { revalidatePath } from "next/cache";

import { and, desc, eq } from "drizzle-orm";

import { customFilters, customFilterTags, filterPresets } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

// --- CUSTOM FILTERS ---
//
// ⚠️ A saved filter is addressed by its id alone, and every function here used to
// take that id from the caller and act on it: no capability asked for, no check
// that the row belonged to whoever was asking. A server action's caller is the
// browser, so one person could delete or repoint another person's saved views by
// passing their id, and nothing would look wrong afterwards.
//
// `record:read` is the bar rather than `record:write`, because saving a view over
// records you can already read is not writing a record — a viewer keeps their own
// filters. What stops one person touching another's is the owner in the where
// clause, on every statement that changes something.

export async function getCustomFilters(entityType: string) {
  const actor = await requireCapability("record:read");
  const db = await getDb();

  return await db
    .select()
    .from(customFilters)
    .where(and(eq(customFilters.entityType, entityType), eq(customFilters.ownerId, actor.userId)))
    .orderBy(desc(customFilters.isPinned), desc(customFilters.createdAt));
}

export async function getPublicFilters(entityType: string) {
  await requireCapability("record:read");
  const db = await getDb();
  return await db
    .select()
    .from(customFilters)
    .where(and(eq(customFilters.entityType, entityType), eq(customFilters.isPublic, true)))
    .orderBy(desc(customFilters.createdAt));
}

export async function createCustomFilter(data: {
  name: string;
  description?: string;
  entityType: string;
  criteria: Record<string, any> | object;
  isPublic?: boolean;
  isPinned?: boolean;
  tags?: string[];
}) {
  const actor = await requireCapability("record:read");
  const db = await getDb();

  // Owner comes from the session, never from the caller, and the tags go in the
  // same commit as the filter they belong to (audit rilievo M-04).
  const id = crypto.randomUUID();
  const writes: unknown[] = [
    db
      .insert(customFilters)
      .values({
        id,
        name: data.name,
        description: data.description,
        entityType: data.entityType,
        ownerId: actor.userId,
        criteria: JSON.stringify(data.criteria),
        isPublic: data.isPublic || false,
        isPinned: data.isPinned || false,
      })
      .returning(),
  ];
  if (data.tags && data.tags.length > 0) {
    writes.push(db.insert(customFilterTags).values(data.tags.map((tag) => ({ filterId: id, tag }))));
  }
  const results = await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
  const [newFilter] = results[0] as (typeof customFilters.$inferSelect)[];

  revalidatePath(`/dashboard/leads`);
  revalidatePath(`/dashboard/contacts`);
  revalidatePath(`/dashboard/companies`);
  revalidatePath(`/dashboard/pipeline`);
  return newFilter;
}

export async function updateCustomFilter(
  id: string,
  data: {
    name?: string;
    description?: string;
    criteria?: Record<string, any>;
    isPublic?: boolean;
    isPinned?: boolean;
  },
) {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  const updateData: Record<string, any> = {};
  if (data.name) updateData.name = data.name;
  if (data.description) updateData.description = data.description;
  if (data.criteria) updateData.criteria = JSON.stringify(data.criteria);
  if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
  if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;
  updateData.updatedAt = new Date();

  const [updated] = await db
    .update(customFilters)
    .set(updateData)
    .where(and(eq(customFilters.id, id), eq(customFilters.ownerId, actor.userId)))
    .returning();

  revalidatePath(`/dashboard/leads`);
  revalidatePath(`/dashboard/contacts`);
  revalidatePath(`/dashboard/companies`);
  revalidatePath(`/dashboard/pipeline`);
  return updated;
}

export async function deleteCustomFilter(id: string) {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  // The tags go with the filter or neither goes, and only the owner's filter is
  // reachable: an id belonging to someone else matches no row.
  await db.batch([
    db.delete(customFilterTags).where(eq(customFilterTags.filterId, id)),
    db.delete(customFilters).where(and(eq(customFilters.id, id), eq(customFilters.ownerId, actor.userId))),
  ]);
  revalidatePath(`/dashboard/leads`);
  revalidatePath(`/dashboard/contacts`);
  revalidatePath(`/dashboard/companies`);
  revalidatePath(`/dashboard/pipeline`);
}

export async function togglePinFilter(id: string, isPinned: boolean) {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  await db
    .update(customFilters)
    .set({ isPinned })
    .where(and(eq(customFilters.id, id), eq(customFilters.ownerId, actor.userId)));
  revalidatePath(`/dashboard/leads`);
}

// --- FILTER PRESETS (System defaults) ---

export async function getFilterPresets(entityType: string) {
  await requireCapability("record:read");
  const db = await getDb();
  return await db.select().from(filterPresets).where(eq(filterPresets.entityType, entityType));
}

export async function createFilterPreset(data: {
  name: string;
  description?: string;
  entityType: string;
  defaultCriteria: Record<string, any>;
}) {
  // A preset is a workspace-wide default, not a personal view.
  await requireCapability("settings:manage");
  const db = await getDb();
  const [newPreset] = await db
    .insert(filterPresets)
    .values({
      name: data.name,
      description: data.description,
      entityType: data.entityType,
      defaultCriteria: JSON.stringify(data.defaultCriteria),
      isSystem: false,
    })
    .returning();

  return newPreset;
}

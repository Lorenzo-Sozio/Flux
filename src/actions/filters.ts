"use server";

import { getDb } from "@/lib/tenant-context";
import { customFilters, customFilterTags, filterPresets } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

// --- CUSTOM FILTERS ---

export async function getCustomFilters(entityType: string) {
  const db = await getDb();
  const session = await auth();
  const userId = session?.user?.id;

  return await db
    .select()
    .from(customFilters)
    .where(
      and(
        eq(customFilters.entityType, entityType),
        eq(customFilters.ownerId, userId!)
      )
    )
    .orderBy(desc(customFilters.isPinned), desc(customFilters.createdAt));
}

export async function getPublicFilters(entityType: string) {
  const db = await getDb();
  return await db
    .select()
    .from(customFilters)
    .where(
      and(
        eq(customFilters.entityType, entityType),
        eq(customFilters.isPublic, true)
      )
    )
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
  const db = await getDb();
  const session = await auth();
  const userId = session?.user?.id;

  const [newFilter] = await db
    .insert(customFilters)
    .values({
      name: data.name,
      description: data.description,
      entityType: data.entityType,
      ownerId: userId!,
      criteria: JSON.stringify(data.criteria),
      isPublic: data.isPublic || false,
      isPinned: data.isPinned || false,
    })
    .returning();

  // Add tags if provided
  if (data.tags && data.tags.length > 0) {
    await db.insert(customFilterTags).values(
      data.tags.map((tag) => ({
        filterId: newFilter.id,
        tag,
      }))
    );
  }

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
  }
) {
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
    .where(eq(customFilters.id, id))
    .returning();

  revalidatePath(`/dashboard/leads`);
  revalidatePath(`/dashboard/contacts`);
  revalidatePath(`/dashboard/companies`);
  revalidatePath(`/dashboard/pipeline`);
  return updated;
}

export async function deleteCustomFilter(id: string) {
  const db = await getDb();
  await db.delete(customFilterTags).where(eq(customFilterTags.filterId, id));
  await db.delete(customFilters).where(eq(customFilters.id, id));
  revalidatePath(`/dashboard/leads`);
  revalidatePath(`/dashboard/contacts`);
  revalidatePath(`/dashboard/companies`);
  revalidatePath(`/dashboard/pipeline`);
}

export async function togglePinFilter(id: string, isPinned: boolean) {
  const db = await getDb();
  await db
    .update(customFilters)
    .set({ isPinned })
    .where(eq(customFilters.id, id));
  revalidatePath(`/dashboard/leads`);
}

// --- FILTER PRESETS (System defaults) ---

export async function getFilterPresets(entityType: string) {
  const db = await getDb();
  return await db
    .select()
    .from(filterPresets)
    .where(eq(filterPresets.entityType, entityType));
}

export async function createFilterPreset(data: {
  name: string;
  description?: string;
  entityType: string;
  defaultCriteria: Record<string, any>;
}) {
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

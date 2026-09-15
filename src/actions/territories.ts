"use server";

import { revalidatePath } from "next/cache";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { territories } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";
import { cleanTerritory, type TerritoryInput } from "@/lib/territory";

export type Territory = typeof territories.$inferSelect;

export type TerritoryResult = { ok: true; territory: Territory } | { ok: false; error: string };

const PAGE = "/dashboard/settings/territories";

/**
 * Every territory, by name.
 *
 * Readable by anyone who can read records: a report grouped by territory, or a rule
 * assigning by one, needs the definitions whoever is looking at it.
 */
export async function getTerritories(): Promise<Territory[]> {
  await requireCapability("record:read");
  const db = await getDb();
  // A workspace the migration has not reached yet has no territories, rather than a
  // broken report or settings page.
  return tolerateUnmigrated("territories", () => db.select().from(territories).orderBy(asc(territories.name)), []);
}

function isNameTaken(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return e?.code === "23505" || e?.cause?.code === "23505" || String(e?.message ?? "").includes("territory_name_uniq");
}

async function nameInUse(name: string, exceptId?: string): Promise<boolean> {
  const db = await getDb();
  const sameName = sql`lower(${territories.name}) = lower(${name})`;
  const [row] = await db
    .select({ id: territories.id })
    .from(territories)
    .where(exceptId ? and(sameName, ne(territories.id, exceptId)) : sameName)
    .limit(1);
  return Boolean(row);
}

const TAKEN = "Another territory already has this name.";

export async function createTerritory(input: TerritoryInput): Promise<TerritoryResult> {
  const actor = await requireCapability("territory:manage");
  const cleaned = cleanTerritory(input);
  if (!cleaned.ok) return cleaned;
  // "Nord" and "nord" in one list are two territories nobody can tell apart.
  if (await nameInUse(cleaned.value.name)) return { ok: false, error: TAKEN };

  const db = await getDb();
  try {
    const [territory] = await db
      .insert(territories)
      .values({ ...cleaned.value, createdBy: actor.userId })
      .returning();
    revalidatePath(PAGE);
    return { ok: true, territory };
  } catch (err) {
    if (isNameTaken(err)) return { ok: false, error: TAKEN };
    throw err;
  }
}

export async function updateTerritory(id: string, input: TerritoryInput): Promise<TerritoryResult> {
  await requireCapability("territory:manage");
  const cleaned = cleanTerritory(input);
  if (!cleaned.ok) return cleaned;
  if (await nameInUse(cleaned.value.name, id)) return { ok: false, error: TAKEN };

  const db = await getDb();
  try {
    const [territory] = await db
      .update(territories)
      .set({ ...cleaned.value, updatedAt: new Date() })
      .where(eq(territories.id, id))
      .returning();
    if (!territory) return { ok: false, error: "This territory no longer exists." };
    revalidatePath(PAGE);
    return { ok: true, territory };
  } catch (err) {
    if (isNameTaken(err)) return { ok: false, error: TAKEN };
    throw err;
  }
}

export async function deleteTerritory(id: string): Promise<{ ok: true }> {
  await requireCapability("territory:manage");
  const db = await getDb();
  await db.delete(territories).where(eq(territories.id, id));
  revalidatePath(PAGE);
  return { ok: true };
}

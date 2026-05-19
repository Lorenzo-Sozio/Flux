"use server";

import { and, eq, ilike, or, sql } from "drizzle-orm";

import { geoCities, geoCountries } from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";
import { slugifyCity } from "@/lib/geo-utils";
import { getDb } from "@/lib/tenant-context";

export type GeoCountry = typeof geoCountries.$inferSelect;
export type GeoCity = typeof geoCities.$inferSelect;

// ── Countries ─────────────────────────────────────────────────────────────────

export async function getCountries(): Promise<GeoCountry[]> {
  const db = await getDb();
  return db.select().from(geoCountries).where(eq(geoCountries.active, true)).orderBy(geoCountries.nameEn);
}

export async function getCountryById(id: string): Promise<GeoCountry | null> {
  const db = await getDb();
  const [row] = await db.select().from(geoCountries).where(eq(geoCountries.id, id));
  return row ?? null;
}

export async function createCountry(data: {
  iso2: string;
  iso3?: string;
  nameEn: string;
  nameIt?: string;
  callingCode?: string;
}): Promise<GeoCountry> {
  await requireWriteAccess();
  const db = await getDb();
  const [row] = await db.insert(geoCountries).values(data).returning();
  return row;
}

// ── Cities ────────────────────────────────────────────────────────────────────

export async function searchCities(query: string, countryId: string): Promise<GeoCity[]> {
  const db = await getDb();
  const q = query.trim();
  if (!q) {
    return db.select().from(geoCities).where(eq(geoCities.countryId, countryId)).orderBy(geoCities.name).limit(20);
  }
  return db
    .select()
    .from(geoCities)
    .where(and(eq(geoCities.countryId, countryId), ilike(geoCities.name, `${q}%`)))
    .orderBy(geoCities.name)
    .limit(20);
}

export async function getCityById(id: string): Promise<GeoCity | null> {
  const db = await getDb();
  const [row] = await db.select().from(geoCities).where(eq(geoCities.id, id));
  return row ?? null;
}

/**
 * Checks whether a city with the same slug already exists for that country.
 * Returns the existing city if found (case-insensitive dedup), null otherwise.
 */
export async function findCityBySlug(countryId: string, name: string): Promise<GeoCity | null> {
  const db = await getDb();
  const slug = slugifyCity(name);
  const [row] = await db
    .select()
    .from(geoCities)
    .where(and(eq(geoCities.countryId, countryId), eq(geoCities.slug, slug)));
  return row ?? null;
}

export async function createCity(countryId: string, name: string, region?: string): Promise<GeoCity> {
  await requireWriteAccess();
  const db = await getDb();
  const slug = slugifyCity(name);

  // Hard dedup guard — even if the client skipped the check
  const existing = await findCityBySlug(countryId, name);
  if (existing) return existing;

  const [row] = await db
    .insert(geoCities)
    .values({
      countryId,
      name: name.trim(),
      slug,
      region: region?.trim() || null,
      postalCodes: [],
    })
    .returning();
  return row;
}

/**
 * Adds a postal code to a city's postal_codes array if not already present.
 */
export async function addPostalCodeToCity(cityId: string, postalCode: string): Promise<void> {
  const db = await getDb();
  const trimmed = postalCode.trim();
  if (!trimmed) return;
  // Atomic array_append — safe under concurrent saves
  await db.execute(
    sql`UPDATE geo_city SET postal_codes = array_append(postal_codes, ${trimmed}) WHERE id = ${cityId} AND NOT (${trimmed} = ANY(postal_codes))`,
  );
}

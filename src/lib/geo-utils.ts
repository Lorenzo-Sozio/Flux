/**
 * Normalizes a city name into a URL-safe slug used for deduplication.
 * "Milàno" → "milano", "San José" → "san-jose", "L'Aquila" → "l-aquila"
 */
export function slugifyCity(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * What a machine-to-machine caller may do, entity by entity (decision D7, 15 September 2026).
 *
 * A scope is `<entity>:<access>`: `contacts:read`, `orders:write`. A key holds a list of
 * them and nothing else — there is no "admin" scope, and no wildcard, because a wildcard is
 * how a key minted to push leads from a website ends up able to read every customer.
 *
 * ⚠️⚠️ Read is not implied by write. The keys that existed before scopes could write
 * everything and read nothing, because nothing could be read; they keep exactly that
 * (`WRITE_ALL`), so adding a read API did not silently hand every old key the database.
 *
 * Pure: the routes, the gate, the settings screen and the tests all import it.
 */

export const API_ENTITIES = [
  "contacts",
  "leads",
  "companies",
  "deals",
  "orders",
  "activities",
  "custom_fields",
  "privacy",
  // Subscribing to events (REST hooks), for Zapier, Make and anything built like them.
  "webhooks",
  // Marking whom an AI assistant is working with (src/lib/assistant-handling.ts).
  "assistant",
  // The catalogue, with the price a given customer pays (read only).
  "products",
  // Draft quotes an integration proposes; the prices are Flux's (src/lib/quote-draft.ts).
  "quotes",
] as const;
export type ApiEntity = (typeof API_ENTITIES)[number];

export const API_ACCESS = ["read", "write"] as const;
export type ApiAccess = (typeof API_ACCESS)[number];

export interface ApiScope {
  entity: ApiEntity;
  access: ApiAccess;
}

/**
 * Which entities can be read at all. Activities, custom fields and privacy requests are
 * written through the API but have no list to read: a scope nothing checks would be a
 * promise on the settings screen that the API does not keep.
 */
export const READABLE: readonly ApiEntity[] = ["contacts", "leads", "companies", "deals", "orders", "products"];

/** Which can be written. The catalogue is read through the API and kept from the dashboard. */
export const WRITABLE: readonly ApiEntity[] = API_ENTITIES.filter((e) => e !== "products");

export const scopeName = (s: ApiScope): string => `${s.entity}:${s.access}`;

/** Every scope a key can be given, in the order the settings screen draws them. */
export const ALL_SCOPES: readonly string[] = API_ENTITIES.flatMap((entity) => [
  ...(READABLE.includes(entity) ? [scopeName({ entity, access: "read" })] : []),
  ...(WRITABLE.includes(entity) ? [scopeName({ entity, access: "write" })] : []),
]);

/**
 * What a key minted before scopes existed may do: everything it could, and no more.
 *
 * ⚠️⚠️ **Written out, never derived from the list of entities.** Derived, every new write
 * scope reached the old keys the day it was added — `webhooks:write` among them, and a
 * subscription to every event is a way to *read* everything the workspace does, the one
 * thing those keys were never able to do. A scope added later is for keys made later.
 */
export const WRITE_ALL: readonly string[] = (
  ["contacts", "leads", "companies", "deals", "orders", "activities", "custom_fields", "privacy"] as const
).map((entity) => scopeName({ entity, access: "write" }));

/** Only real scopes, each once, in a stable order. Anything else is dropped, not kept. */
export function cleanScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter((s): s is string => typeof s === "string"));
  return ALL_SCOPES.filter((s) => wanted.has(s));
}

export function grants(scopes: readonly string[], need: ApiScope): boolean {
  return scopes.includes(scopeName(need));
}

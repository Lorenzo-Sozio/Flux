/**
 * Scoped API keys: made, recognised and looked up (scopes in src/lib/api-scopes.ts).
 *
 * A key reads `flx2.<workspace id>.<secret>`. The workspace id is in clear because the
 * key has to say which database holds it — keys live with the workspace's own data, not in
 * the platform registry — and it is no secret: it names a workspace, it opens nothing.
 * The secret is 32 random bytes; only the SHA-256 of the **whole** key is stored, so the
 * workspace part cannot be swapped onto somebody else's secret.
 *
 * The keys made before scopes (`flx_<hex>`, one per workspace, a hash on the registry)
 * keep working through their own branch of the gate, with the powers they always had.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { apiKeys } from "@/db/schema";

// biome-ignore lint/suspicious/noExplicitAny: platform and tenant handles share the query builders
type AnyDb = NeonHttpDatabase<any>;

const PREFIX = "flx2.";
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
/** Last-used is written at most this often: a statement per request would be a write per read. */
const TOUCH_EVERY_MS = 60 * 60_000;

export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

/** A new key for a workspace: the key itself, shown once, and what is stored instead of it. */
export function newScopedKey(workspaceId: string): { key: string; hash: string; hint: string } {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error("workspace id cannot be carried in a key");
  const key = `${PREFIX}${workspaceId}.${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashKey(key), hint: key.slice(-4) };
}

/** The workspace a key names, or null when it is not a scoped key at all. Says nothing about validity. */
export function workspaceOfKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  const workspaceId = rest.slice(0, dot);
  const secret = rest.slice(dot + 1);
  return WORKSPACE_ID.test(workspaceId) && SECRET.test(secret) ? workspaceId : null;
}

/** The live key with this exact value, and what it may do; null when unknown or revoked. */
export async function findScopedKey(
  db: AnyDb,
  key: string,
  now = new Date(),
): Promise<{ id: string; name: string; scopes: string[] } | null> {
  const [row] = await db
    .select({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.hash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    // Best effort: a key that works must not stop working because a timestamp did not save.
    await db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);
  }
  return { id: row.id, name: row.name, scopes: row.scopes ?? [] };
}

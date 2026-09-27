/**
 * A person's connected mailbox, as stored: at most one per person, tokens encrypted with the
 * platform key and refreshed when they run out.
 *
 * ⚠️⚠️ **A token is decrypted only to be used.** Nothing here returns one to a caller that
 * could hand it to a browser; the actions that describe a connection read `email`, `status`
 * and when it last worked.
 *
 * ⚠️ **A refused refresh ends the connection, visibly.** A grant withdrawn at the provider
 * answers 400/401 on refresh for ever; the row is marked `revoked` with the reason, the
 * profile says "reconnect", and every job skips it — rather than retrying a dead grant every
 * ten minutes and filling the log.
 */
import { and, eq } from "drizzle-orm";

import { mailConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/tenant-db";

import { type MailProvider, type MailProviderId, ProviderError, type TokenSet } from "./mail-providers/types";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type MailConnectionRow = typeof mailConnections.$inferSelect;

export async function loadConnection(db: AnyDb, userId: string): Promise<MailConnectionRow | null> {
  const [row] = await db.select().from(mailConnections).where(eq(mailConnections.userId, userId));
  return row ?? null;
}

/**
 * Stores a new grant. The same mailbox connected again keeps its row — and with it where
 * reading had got to and which events mirror which appointments; a different mailbox
 * replaces it.
 */
export async function saveConnection(
  db: AnyDb,
  input: { userId: string; provider: MailProviderId; email: string; tokens: TokenSet; cursor: string },
  now = new Date(),
): Promise<void> {
  const existing = await loadConnection(db, input.userId);
  const tokens = {
    accessToken: encryptSecret(input.tokens.accessToken),
    ...(input.tokens.refreshToken ? { refreshToken: encryptSecret(input.tokens.refreshToken) } : {}),
    expiresAt: input.tokens.expiresAt,
    scopes: input.tokens.scopes.join(" "),
  };
  if (existing && existing.provider === input.provider && existing.email === input.email) {
    await db
      .update(mailConnections)
      .set({
        ...tokens,
        status: "active",
        lastError: null,
        lastErrorAt: null,
        // Re-authorised while working: carry on from where it was. Connected again after a
        // revocation: from now, like any new connection — never the weeks in between.
        mailCursor: existing.status === "active" ? (existing.mailCursor ?? input.cursor) : input.cursor,
        busySyncedAt: null,
        updatedAt: now,
      })
      .where(eq(mailConnections.id, existing.id));
    return;
  }
  if (existing) await db.delete(mailConnections).where(eq(mailConnections.id, existing.id));
  await db
    .insert(mailConnections)
    .values({
      userId: input.userId,
      provider: input.provider,
      email: input.email,
      ...tokens,
      mailCursor: input.cursor,
      createdAt: now,
      updatedAt: now,
    })
    // Two callbacks at once (a double click): the first row stands, the second is not an error.
    .onConflictDoNothing();
}

/** The provider says this grant is over: withdrawn, expired, or needing the person again. */
export function isGrantRefused(err: ProviderError): boolean {
  return (err.status === 400 || err.status === 401) && /invalid_grant|interaction_required/.test(err.message);
}

export async function recordConnectionError(db: AnyDb, id: string, err: unknown, now = new Date()): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  await db.update(mailConnections).set({ lastError: message, lastErrorAt: now }).where(eq(mailConnections.id, id));
}

async function markRevoked(db: AnyDb, id: string, reason: string, now: Date) {
  await db
    .update(mailConnections)
    .set({ status: "revoked", lastError: reason.slice(0, 500), lastErrorAt: now, updatedAt: now })
    .where(eq(mailConnections.id, id));
}

/**
 * A token that works now, refreshing it when it has run out; null when the connection is
 * no longer usable (and the row says why).
 */
export async function accessTokenFor(
  db: AnyDb,
  conn: MailConnectionRow,
  provider: MailProvider,
  now = new Date(),
): Promise<string | null> {
  if (conn.status !== "active") return null;
  if (conn.expiresAt.getTime() > now.getTime()) return decryptSecret(conn.accessToken);
  if (!conn.refreshToken) {
    await markRevoked(db, conn.id, "No refresh token: connect the mailbox again.", now);
    return null;
  }
  let fresh: TokenSet;
  try {
    fresh = await provider.refresh(decryptSecret(conn.refreshToken));
  } catch (err) {
    // ⚠️⚠️ Only the grant itself being refused ends the connection. A 400/401 is also what a
    // mistyped or expired client secret produces — and revoking on that would disconnect every
    // mailbox of every workspace at the next refresh, each to be reconnected by hand.
    if (err instanceof ProviderError && isGrantRefused(err)) {
      await markRevoked(db, conn.id, err.message, now);
      return null;
    }
    await recordConnectionError(db, conn.id, err, now);
    return null;
  }
  await db
    .update(mailConnections)
    .set({
      accessToken: encryptSecret(fresh.accessToken),
      // ⚠️ Microsoft rotates the refresh token: keeping the old one works until it doesn't.
      ...(fresh.refreshToken ? { refreshToken: encryptSecret(fresh.refreshToken) } : {}),
      expiresAt: fresh.expiresAt,
      updatedAt: now,
    })
    // Only while it is still the row that was read: a reconnection in between wins.
    .where(and(eq(mailConnections.id, conn.id), eq(mailConnections.accessToken, conn.accessToken)));
  return fresh.accessToken;
}

/**
 * Forgets the connection: asks the provider to withdraw the grant (best effort), then
 * deletes the row, its busy time and its mirror records. Events already written to the
 * person's calendar stay there — they are the person's now.
 */
export async function disconnectMailbox(db: AnyDb, userId: string, provider: MailProvider | null): Promise<boolean> {
  const conn = await loadConnection(db, userId);
  if (!conn) return false;
  if (provider) {
    const token = conn.refreshToken ?? conn.accessToken;
    try {
      await provider.revoke(decryptSecret(token));
    } catch (err) {
      // The grant stays at the provider, where the person can remove it; the row goes anyway.
      console.warn("[mail-connection] revoke failed", err instanceof Error ? err.message : err);
    }
  }
  await db.delete(mailConnections).where(eq(mailConnections.id, conn.id));
  return true;
}

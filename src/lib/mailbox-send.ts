/**
 * An email written in the CRM, sent from the writer's own connected mailbox (V3.2): it goes
 * out as them, sits in their Sent folder, and the answer comes back to their inbox — where
 * src/lib/mail-sync.ts reads it and files it on the record.
 *
 * ⚠️ **A connection that works is used, or the send fails.** An error from the provider is
 * the person's to see; quietly sending from the workspace's address instead would put a
 * different sender in front of the customer than the one who wrote. A connection that is not
 * there — never made, revoked, or its provider switched off here — is simply not used.
 */
import { accessTokenFor, loadConnection } from "@/lib/mail-connection";
import { providerFor } from "@/lib/mail-providers/registry";
import type { FetchLike, MailProviderId } from "@/lib/mail-providers/types";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type MailboxSend =
  | { used: false }
  | { used: true; ok: true; from: string; messageId: string | null }
  | { used: true; ok: false; error: string };

export async function sendFromOwnMailbox(
  db: AnyDb,
  userId: string,
  mail: { to: string[]; cc?: string[]; subject: string; html: string; fromName?: string | null },
  options: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike; now?: Date } = {},
): Promise<MailboxSend> {
  const conn = await loadConnection(db, userId);
  if (!conn || conn.status !== "active") return { used: false };
  const provider = providerFor(conn.provider as MailProviderId, options.env, options.fetchImpl);
  if (!provider) return { used: false };
  const token = await accessTokenFor(db, conn, provider, options.now);
  if (!token) {
    // Refused just now: the row says revoked, and the workspace sends, as for anybody unconnected.
    // ⚠️ Still active means a passing failure at the provider: the send fails, visibly, rather
    // than going out from an address the writer did not choose.
    const after = await loadConnection(db, userId);
    if (after?.status !== "active") return { used: false };
    return { used: true, ok: false, error: after.lastError ?? "The mailbox did not answer." };
  }
  try {
    const sent = await provider.send(token, { from: conn.email, ...mail });
    return { used: true, ok: true, from: conn.email, messageId: sent.messageId };
  } catch (err) {
    return { used: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

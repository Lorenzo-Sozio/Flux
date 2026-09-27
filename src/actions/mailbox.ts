"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth-guard";
import { disconnectMailbox, loadConnection } from "@/lib/mail-connection";
import { mayConnect, type ProviderState, providerFor, providerState } from "@/lib/mail-providers/registry";
import { MAIL_PROVIDER_IDS, type MailProviderId } from "@/lib/mail-providers/types";
import { can } from "@/lib/permissions";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

export interface MailboxState {
  providers: { id: MailProviderId; state: ProviderState; canConnect: boolean }[];
  /** A viewer connects nothing: what the sync files is written on the records. */
  readOnly: boolean;
  connection: {
    provider: MailProviderId;
    email: string;
    status: "active" | "revoked";
    lastError: string | null;
    lastErrorAt: Date | null;
    mailSyncedAt: Date | null;
    busySyncedAt: Date | null;
    connectedAt: Date;
  } | null;
}

/**
 * The signed-in person's connected mailbox (V3.2), and what may be connected here. Never a
 * token: only what the profile shows.
 */
export async function getOwnMailbox(): Promise<MailboxState> {
  const actor = await requireCapability("record:read");
  const readOnly = !can(actor, "record:write");
  const providers = MAIL_PROVIDER_IDS.map((id) => ({
    id,
    state: providerState(id),
    canConnect: !readOnly && mayConnect(id, actor),
  }));
  const conn = await tolerateUnmigrated("mailboxes", async () => loadConnection(await getDb(), actor.userId), null);
  return {
    providers,
    readOnly,
    connection: conn
      ? {
          provider: conn.provider as MailProviderId,
          email: conn.email,
          status: conn.status === "active" ? "active" : "revoked",
          lastError: conn.lastError,
          lastErrorAt: conn.lastErrorAt,
          mailSyncedAt: conn.mailSyncedAt,
          busySyncedAt: conn.busySyncedAt,
          connectedAt: conn.createdAt,
        }
      : null,
  };
}

/** Anybody may disconnect their own mailbox, whatever their role: it is theirs. */
export async function disconnectMailboxAction(): Promise<MailboxState> {
  const actor = await requireCapability("record:read");
  const db = await getDb();
  const conn = await loadConnection(db, actor.userId);
  await disconnectMailbox(db, actor.userId, conn ? providerFor(conn.provider as MailProviderId) : null);
  revalidatePath("/dashboard/profile");
  return getOwnMailbox();
}

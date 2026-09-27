/**
 * Which mailbox providers this deployment may offer, and to whom (decision D-B).
 *
 * - **off** — no credentials. Nothing is offered; the profile says the connection is not
 *   available here.
 * - **testing** — credentials, but the deployment has not declared the provider's
 *   verification done (`MAIL_GOOGLE_VERIFIED=1` / `MAIL_MICROSOFT_VERIFIED=1`). Google keeps
 *   an unverified app to its listed test users and expires their grant within a week, so
 *   only Flux's own staff may connect: it is how the integration is tried, never how a
 *   customer uses it.
 * - **on** — credentials and verification: anybody may connect their own mailbox.
 *
 * ⚠️ A flag, not a check: nothing here can ask Google whether the review passed. Setting it
 * is a statement by whoever operates the deployment, and belongs next to the review's result.
 */
import type { Actor } from "@/lib/permissions";

import { googleProvider } from "./google";
import { microsoftProvider } from "./microsoft";
import { type FetchLike, MAIL_PROVIDER_IDS, type MailProvider, type MailProviderId } from "./types";

export type ProviderState = "off" | "testing" | "on";

type Env = Record<string, string | undefined>;

function credentials(id: MailProviderId, env: Env) {
  const prefix = id === "google" ? "MAIL_GOOGLE" : "MAIL_MICROSOFT";
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret
    ? { clientId, clientSecret, verified: env[`${prefix}_VERIFIED`] === "1", tenant: env.MAIL_MICROSOFT_TENANT }
    : null;
}

export function providerState(id: MailProviderId, env: Env = process.env): ProviderState {
  const c = credentials(id, env);
  if (!c) return "off";
  return c.verified ? "on" : "testing";
}

/** The provider's client, or null when it is off. */
export function providerFor(id: MailProviderId, env: Env = process.env, fetchImpl?: FetchLike): MailProvider | null {
  const c = credentials(id, env);
  if (!c) return null;
  return id === "google"
    ? googleProvider(c, fetchImpl)
    : microsoftProvider({ clientId: c.clientId, clientSecret: c.clientSecret, tenant: c.tenant }, fetchImpl);
}

/** Whether this person may start a connection to this provider. */
export function mayConnect(id: MailProviderId, actor: Pick<Actor, "isPlatformStaff">, env: Env = process.env): boolean {
  const state = providerState(id, env);
  return state === "on" || (state === "testing" && actor.isPlatformStaff);
}

export function isProviderId(value: unknown): value is MailProviderId {
  return typeof value === "string" && (MAIL_PROVIDER_IDS as readonly string[]).includes(value);
}

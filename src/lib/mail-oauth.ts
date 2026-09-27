/**
 * The round trip to Google or Microsoft and back, when a person connects their mailbox.
 *
 * ⚠️⚠️ **Three things tie the answer to the person who asked.**
 * - The `state` is signed (HMAC with AUTH_SECRET) and names the workspace, the person and
 *   the provider, with ten minutes to live: a callback cannot be pointed at somebody else's
 *   workspace or account.
 * - A nonce in the state must equal the one in an httpOnly cookie set when the trip began:
 *   a link to a finished authorization, sent to a colleague, connects nothing on their side.
 * - PKCE: the code is useless without the verifier, which never leaves this server and that
 *   browser's cookie.
 * The callback also requires the signed-in person to be the one the state names.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { MailProviderId } from "./mail-providers/types";

export const OAUTH_COOKIE = "flux_mail_oauth";
export const OAUTH_TTL_SECONDS = 600;

export interface OAuthState {
  tenantId: string;
  userId: string;
  provider: MailProviderId;
  nonce: string;
  /** Seconds since the epoch. */
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function secret(env: Record<string, string | undefined>): string {
  const s = env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set: a mailbox connection cannot be signed.");
  return s;
}

function sign(payload: string, env: Record<string, string | undefined>): string {
  return b64url(createHmac("sha256", secret(env)).update(`mail-oauth:${payload}`).digest());
}

/** A fresh trip: the state to send, and the cookie that must come back with it. */
export function beginOAuth(
  input: { tenantId: string; userId: string; provider: MailProviderId },
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): { state: string; cookie: string; codeChallenge: string } {
  const nonce = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(32));
  const payload = b64url(
    Buffer.from(JSON.stringify({ ...input, nonce, exp: Math.floor(now / 1000) + OAUTH_TTL_SECONDS })),
  );
  return {
    state: `${payload}.${sign(payload, env)}`,
    cookie: `${nonce}.${verifier}`,
    codeChallenge: b64url(createHash("sha256").update(verifier).digest()),
  };
}

export type OAuthCheck = { ok: true; state: OAuthState; codeVerifier: string } | { ok: false; reason: string };

/** The state and cookie that came back, checked; the verifier to redeem the code with. */
export function finishOAuth(
  input: { state: string | null; cookie: string | null | undefined; provider: MailProviderId },
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): OAuthCheck {
  if (!input.state || !input.cookie) return { ok: false, reason: "missing" };
  const [payload, mac, extra] = input.state.split(".");
  if (!payload || !mac || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(payload, env));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature" };

  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof state.exp !== "number" || state.exp * 1000 < now) return { ok: false, reason: "expired" };
  if (state.provider !== input.provider) return { ok: false, reason: "provider" };

  const [nonce, verifier, more] = input.cookie.split(".");
  if (!nonce || !verifier || more !== undefined) return { ok: false, reason: "cookie" };
  const a = Buffer.from(nonce);
  const b = Buffer.from(state.nonce ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "cookie" };

  return { ok: true, state, codeVerifier: verifier };
}

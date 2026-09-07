/**
 * Web Push: VAPID authentication (RFC 8292) and aes128gcm payload encryption
 * (RFC 8188 / RFC 8291), written against the Web Crypto API.
 *
 * ⚠️ **Not the `web-push` npm package, deliberately.** That library reaches for
 * Node's `crypto` and `https` modules. This product deploys to Cloudflare Workers
 * as well as Vercel, where those are polyfills of varying completeness, and the
 * failure mode of a half-working polyfill here is the worst one available: the
 * send throws or returns a 400 from a push service, nobody is watching, and the
 * feature simply never delivers anything. Web Crypto is the same API in both
 * runtimes and in the browser.
 *
 * ⚠️ **Nothing in here is guesswork about the wire format.** The four byte
 * strings the derivation depends on are named constants below, quoted from the
 * RFCs, and `web-push.test.ts` pins them — because getting one of them wrong
 * produces a body that encrypts and sends perfectly and that no browser on earth
 * can decrypt. There is no error to see: the push service answers 201.
 */

// ── Base64url ────────────────────────────────────────────────────────────────

/** base64url, no padding — every field in VAPID and in a subscription uses it. */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Accepts padded or unpadded, standard or url alphabet — subscriptions vary. */
export function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── The constants the whole scheme hangs on ──────────────────────────────────

/**
 * RFC 8291 §3.4. The context for deriving the input keying material, built as
 * `"WebPush: info" || 0x00 || ua_public || as_public`.
 */
const WEBPUSH_INFO_PREFIX = "WebPush: info";

/** RFC 8188 §2.2 — the content-encryption key context, NUL-terminated. */
const CEK_INFO = "Content-Encoding: aes128gcm\0";

/** RFC 8188 §2.3 — the nonce context, NUL-terminated. */
const NONCE_INFO = "Content-Encoding: nonce\0";

/** RFC 8188: AES-128-GCM, so a 16 byte key and a 12 byte nonce. */
const CEK_BYTES = 16;
const NONCE_BYTES = 12;

/** The record size written into the header. One record is all we ever send. */
const RECORD_SIZE = 4096;

/**
 * The largest plaintext a push service is required to accept.
 *
 * 4096 bytes is the guaranteed body size; the header (86 bytes), the GCM tag
 * (16) and the record delimiter (1) all come out of it. Anything longer is
 * refused here rather than by a remote 413 nobody reads, and callers are
 * expected to send a title and a line, not a document.
 */
export const MAX_PAYLOAD_BYTES = 4096 - 86 - 16 - 1;

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** HKDF-SHA256 extract-and-expand, which is what `deriveBits` does in one step. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── Payload encryption ───────────────────────────────────────────────────────

export interface PushKeys {
  /** The subscriber's public key, `p256dh` in the browser's subscription. */
  p256dh: string;
  /** The subscriber's authentication secret, 16 bytes. */
  auth: string;
}

/**
 * Encrypts one message for one subscriber, producing a complete aes128gcm body.
 *
 * `salt` and `serverKeys` are injectable so a test can reproduce a known result;
 * production never passes them.
 */
export async function encryptPayload(
  plaintext: string,
  keys: PushKeys,
  overrides?: { salt?: Uint8Array; serverKeys?: CryptoKeyPair },
): Promise<Uint8Array> {
  const message = encoder.encode(plaintext);
  if (message.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payload is ${message.length} bytes; the limit is ${MAX_PAYLOAD_BYTES}.`);
  }

  const uaPublic = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);

  const serverKeys =
    overrides?.serverKeys ??
    (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, serverKeys.privateKey, 256),
  );

  // ⚠️ The order is `ua_public` then `as_public`, and swapping them yields a
  // body the browser silently cannot open. RFC 8291 §3.4.
  const keyInfo = concat(encoder.encode(WEBPUSH_INFO_PREFIX), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = overrides?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode(CEK_INFO), CEK_BYTES);
  const nonce = await hkdf(salt, ikm, encoder.encode(NONCE_INFO), NONCE_BYTES);

  // A single record, so the delimiter is 0x02 ("last record"). 0x01 here means
  // "more records follow" and the browser waits for one that never comes.
  const record = concat(message, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, record as BufferSource),
  );

  // Header: salt(16) || record size(4, big-endian) || key id length(1) || key id.
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  return concat(header, ciphertext);
}

// ── VAPID ────────────────────────────────────────────────────────────────────

export interface VapidKeys {
  /** Uncompressed P-256 public point, base64url — 65 bytes. */
  publicKey: string;
  /** The private scalar, base64url — 32 bytes. */
  privateKey: string;
  /** A contact a push service can use when something is wrong: mailto: or https:. */
  subject: string;
}

/** How long a VAPID token stays valid. The specification caps this at 24 hours. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/**
 * Web Crypto cannot import a bare private scalar, so the key is rebuilt as a JWK
 * from the scalar plus the two halves of the public point.
 */
async function importVapidKey(keys: VapidKeys): Promise<CryptoKey> {
  const publicBytes = fromBase64Url(keys.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    throw new Error("VAPID public key must be a 65 byte uncompressed P-256 point.");
  }
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: toBase64Url(publicBytes.slice(1, 33)),
      y: toBase64Url(publicBytes.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The `Authorization` header for one push endpoint.
 *
 * The audience is the *origin* of the endpoint, not the endpoint itself. A token
 * signed for the wrong audience comes back as a 401 from the push service, which
 * is at least loud — unlike everything else that can go wrong here.
 */
export async function vapidHeader(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(now / 1000) + VAPID_TTL_SECONDS,
        sub: keys.subject,
      }),
    ),
  );

  const signingInput = `${header}.${payload}`;
  const key = await importVapidKey(keys);
  // ECDSA through Web Crypto is already the raw r||s pair a JWT wants; the DER
  // wrapping that OpenSSL produces would be rejected.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput) as BufferSource,
  );

  return `vapid t=${signingInput}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome =
  /** Accepted by the push service. It may still never reach a screen. */
  | { status: "sent" }
  /** The subscription is dead: the browser uninstalled it or revoked permission. */
  | { status: "gone" }
  /** Temporary — a retry later might work. */
  | { status: "retry"; detail: string }
  /** Our fault: a malformed payload, a bad key, an oversized message. */
  | { status: "failed"; detail: string };

/**
 * Delivers one notification to one subscription.
 *
 * ⚠️ Returns an outcome and never throws for a remote failure. A push that
 * cannot be delivered must not take down the action that caused it — somebody
 * assigning a task cares whether the task was assigned, not whether a phone
 * lit up.
 *
 * The caller is expected to act on `"gone"` by deleting the subscription. A
 * subscription that answers 410 answers 410 forever, and a table of them turns
 * every notification into a fan-out of guaranteed failures.
 */
export async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: string,
  keys: VapidKeys,
  options?: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high" },
): Promise<PushOutcome> {
  let body: Uint8Array;
  let authorization: string;
  try {
    body = await encryptPayload(payload, subscription);
    authorization = await vapidHeader(subscription.endpoint, keys);
  } catch (error) {
    // A local failure is a bug in our configuration or our payload, and no
    // amount of retrying will change it.
    return { status: "failed", detail: error instanceof Error ? error.message : "encryption failed" };
  }

  let response: Response;
  try {
    response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options?.ttlSeconds ?? 12 * 60 * 60),
        Urgency: options?.urgency ?? "normal",
      },
      body: body as BodyInit,
    });
  } catch (error) {
    return { status: "retry", detail: error instanceof Error ? error.message : "network error" };
  }

  if (response.status === 404 || response.status === 410) return { status: "gone" };
  if (response.ok) return { status: "sent" };
  if (response.status === 429 || response.status >= 500) {
    return { status: "retry", detail: `push service answered ${response.status}` };
  }
  return { status: "failed", detail: `push service answered ${response.status}` };
}

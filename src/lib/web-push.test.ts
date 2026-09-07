/**
 * What a browser would do with what we send it.
 *
 * ⚠️ The decryptor in this file is written out longhand, with the RFC's byte
 * strings typed in as literals rather than imported from the module under test.
 * That is the whole point. A round-trip that shares its constants with the
 * encryptor passes just as happily when both are wrong, and "both are wrong" is
 * the realistic failure here: every push service answers 201 to a body it cannot
 * read, because it is not the one reading it. The first sign of a mistake would
 * be users reporting that notifications never arrive, months later, with nothing
 * in any log.
 *
 * So this decryptor is the browser's side, and it is deliberately duplicated
 * work. If someone changes an info string in `web-push.ts`, these go red.
 */
import { describe, expect, it, vi } from "vitest";

import {
  encryptPayload,
  fromBase64Url,
  MAX_PAYLOAD_BYTES,
  type PushSubscriptionRecord,
  sendPush,
  toBase64Url,
  type VapidKeys,
  vapidHeader,
} from "./web-push";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** HKDF-SHA256, written here so the test does not borrow the module's version. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** A subscriber: an ECDH keypair and a 16 byte authentication secret. */
async function makeSubscriber() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, uaPublic: raw, p256dh: toBase64Url(raw), auth: toBase64Url(auth), authBytes: auth };
}

/** The receiving half of RFC 8291, with every context string typed in by hand. */
async function decrypt(
  body: Uint8Array,
  subscriber: Awaited<ReturnType<typeof makeSubscriber>>,
): Promise<{ text: string; recordSize: number; keyIdLength: number }> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const salt = body.slice(0, 16);
  const recordSize = view.getUint32(16, false);
  const keyIdLength = body[20];
  const asPublic = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);

  const asPublicKey = await crypto.subtle.importKey(
    "raw",
    asPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: asPublicKey }, subscriber.pair.privateKey, 256),
  );

  const keyInfo = concat(encoder.encode("WebPush: info\0"), subscriber.uaPublic, asPublic);
  const ikm = await hkdf(subscriber.authBytes, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, ciphertext as BufferSource),
  );

  // The last byte is the padding delimiter: 0x02 on the final record.
  expect(record[record.length - 1]).toBe(2);
  return { text: decoder.decode(record.slice(0, -1)), recordSize, keyIdLength };
}

describe("the encrypted payload", () => {
  it("⚠️ can be opened by the subscriber it was written for", async () => {
    const subscriber = await makeSubscriber();
    const message = JSON.stringify({ title: "Nuovo lead assegnato", body: "Maria Rossi — Acme S.p.A." });

    const body = await encryptPayload(message, { p256dh: subscriber.p256dh, auth: subscriber.auth });

    expect((await decrypt(body, subscriber)).text).toBe(message);
  });

  it("survives the characters a CRM actually puts in a notification", async () => {
    // Accented Italian, an em dash and an emoji all cross the UTF-8 boundary the
    // record length is measured in.
    const subscriber = await makeSubscriber();
    const message = "Attività in scadenza — «Richiamare Perù» ✅";

    const body = await encryptPayload(message, { p256dh: subscriber.p256dh, auth: subscriber.auth });

    expect((await decrypt(body, subscriber)).text).toBe(message);
  });

  it("writes the header the format requires", async () => {
    const subscriber = await makeSubscriber();

    const body = await encryptPayload("x", { p256dh: subscriber.p256dh, auth: subscriber.auth });
    const opened = await decrypt(body, subscriber);

    expect(opened.recordSize).toBe(4096);
    // An uncompressed P-256 point: one tag byte and two 32 byte coordinates.
    expect(opened.keyIdLength).toBe(65);
    expect(body[21]).toBe(0x04);
  });

  it("gives every message its own salt and its own ephemeral key", async () => {
    // Reusing either across messages is a real attack on the scheme, and the
    // cheapest way to introduce it is a well-meant cache of the server keypair.
    const subscriber = await makeSubscriber();

    const first = await encryptPayload("same text", { p256dh: subscriber.p256dh, auth: subscriber.auth });
    const second = await encryptPayload("same text", { p256dh: subscriber.p256dh, auth: subscriber.auth });

    expect(toBase64Url(first.slice(0, 16))).not.toBe(toBase64Url(second.slice(0, 16)));
    expect(toBase64Url(first.slice(21, 86))).not.toBe(toBase64Url(second.slice(21, 86)));
  });

  it("⚠️ refuses a message no push service would carry", async () => {
    // Rejected here, where the caller can see it, rather than as a 413 from a
    // push service in a fire-and-forget send nobody is watching.
    const subscriber = await makeSubscriber();
    const tooLong = "a".repeat(MAX_PAYLOAD_BYTES + 1);

    await expect(encryptPayload(tooLong, { p256dh: subscriber.p256dh, auth: subscriber.auth })).rejects.toThrow(
      /limit/,
    );
  });
});

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(97));
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it("produces nothing a URL would have to escape", () => {
    // A subscription's keys travel in JSON and in headers. `+`, `/` and `=` are
    // exactly the characters that come back mangled.
    const encoded = toBase64Url(new Uint8Array([251, 255, 190, 0, 1, 2]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("⚠️ reads back what a browser hands over, padded or not", () => {
    // `PushSubscription.toJSON()` is unpadded base64url, but subscriptions get
    // copied through configuration by hand and arrive padded, or in the standard
    // alphabet. Refusing those would look like a broken device.
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    const urlSafe = toBase64Url(bytes);
    const padded = `${urlSafe}${"=".repeat((4 - (urlSafe.length % 4)) % 4)}`;
    const standard = padded.replace(/-/g, "+").replace(/_/g, "/");

    expect([...fromBase64Url(padded)]).toEqual([...bytes]);
    expect([...fromBase64Url(standard)]).toEqual([...bytes]);
  });
});

/** A VAPID keypair in the shape the environment variables hold. */
async function makeVapidKeys(subject = "mailto:supporto@example.com"): Promise<VapidKeys & { verify: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: toBase64Url(raw), privateKey: jwk.d as string, subject, verify: pair.publicKey };
}

describe("the VAPID header", () => {
  it("⚠️ carries a signature the push service can check", async () => {
    const keys = await makeVapidKeys();

    const header = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc123", keys);
    const token = header.match(/t=([^,]+)/)?.[1] ?? "";
    const [head, payload, signature] = token.split(".");

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.verify,
      fromBase64Url(signature) as BufferSource,
      new TextEncoder().encode(`${head}.${payload}`) as BufferSource,
    );
    expect(valid).toBe(true);
  });

  it("⚠️ addresses the origin, not the endpoint", async () => {
    // The audience is the push service, not the individual subscription. Signing
    // for the full endpoint is a 401, and one that only appears in production
    // because a local test with a fake endpoint never reaches a real service.
    const keys = await makeVapidKeys();

    const header = await vapidHeader("https://updates.push.services.mozilla.com/wpush/v2/gAAAA-long-token", keys);
    const claims = JSON.parse(decoder.decode(fromBase64Url(header.match(/t=[^.]+\.([^.]+)\./)?.[1] ?? "")));

    expect(claims.aud).toBe("https://updates.push.services.mozilla.com");
  });

  it("expires, and inside the day the specification allows", async () => {
    const keys = await makeVapidKeys();
    const now = 1_770_000_000_000;

    const header = await vapidHeader("https://example.push/endpoint", keys, now);
    const claims = JSON.parse(decoder.decode(fromBase64Url(header.match(/t=[^.]+\.([^.]+)\./)?.[1] ?? "")));

    expect(claims.exp).toBeGreaterThan(now / 1000);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 60 * 60);
    expect(claims.sub).toBe("mailto:supporto@example.com");
  });

  it("names the key it signed with, so the service can find it", async () => {
    const keys = await makeVapidKeys();

    const header = await vapidHeader("https://example.push/endpoint", keys);

    expect(header.startsWith("vapid t=")).toBe(true);
    expect(header).toContain(`, k=${keys.publicKey}`);
  });
});

describe("what comes back from a push service", () => {
  async function send(reply: Response | Error) {
    const subscriber = await makeSubscriber();
    const keys = await makeVapidKeys();
    const subscription: PushSubscriptionRecord = {
      endpoint: "https://example.push/endpoint",
      p256dh: subscriber.p256dh,
      auth: subscriber.auth,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)));
    try {
      const outcome = await sendPush(subscription, "hello", keys);
      // Read the recorded call before restoring: `mockRestore` forgets it.
      const call = fetchMock.mock.calls[0];
      return { outcome, call };
    } finally {
      fetchMock.mockRestore();
    }
  }

  it("treats 201 as delivered to the service", async () => {
    expect((await send(new Response(null, { status: 201 }))).outcome).toEqual({ status: "sent" });
  });

  it("⚠️ reports a 410 as gone, so the dead subscription can be deleted", async () => {
    // A revoked or reinstalled browser answers 410 forever. Left in the table it
    // turns every future notification into a guaranteed failed request, for that
    // user, for as long as the row exists.
    expect((await send(new Response(null, { status: 410 }))).outcome).toEqual({ status: "gone" });
    expect((await send(new Response(null, { status: 404 }))).outcome).toEqual({ status: "gone" });
  });

  it("separates what is worth retrying from what is not", async () => {
    expect((await send(new Response(null, { status: 429 }))).outcome.status).toBe("retry");
    expect((await send(new Response(null, { status: 503 }))).outcome.status).toBe("retry");
    expect((await send(new Response(null, { status: 400 }))).outcome.status).toBe("failed");
  });

  it("⚠️ never throws when the network does", async () => {
    // This runs inside `after()` behind a server action. An exception here would
    // surface as a failed save of something that in fact saved.
    const { outcome } = await send(new TypeError("fetch failed"));
    expect(outcome.status).toBe("retry");
  });

  it("sends the headers the format is identified by", async () => {
    const { call } = await send(new Response(null, { status: 201 }));
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;

    expect(init.method).toBe("POST");
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization.startsWith("vapid t=")).toBe(true);
    expect(Number(headers.TTL)).toBeGreaterThan(0);
  });
});

/**
 * The round trip to a mailbox provider (src/lib/mail-oauth.ts), the MIME a send is built
 * from (src/lib/mail-providers/mime.ts) and which providers are offered to whom
 * (src/lib/mail-providers/registry.ts).
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { beginOAuth, finishOAuth } from "./mail-oauth";
import {
  addressesIn,
  base64UrlDecode,
  base64UrlEncode,
  buildRfc822,
  encodeWord,
  htmlToText,
} from "./mail-providers/mime";
import { mayConnect, providerFor, providerState } from "./mail-providers/registry";

const ENV = { AUTH_SECRET: "a-secret-for-tests-only" };
const NOW = Date.parse("2026-09-27T10:00:00Z");
const who = { tenantId: "t1", userId: "anna", provider: "google" as const };

describe("⚠️⚠️ the OAuth round trip", () => {
  it("comes back whole: the state, the cookie, and the verifier the challenge was made from", () => {
    const trip = beginOAuth(who, NOW, ENV);
    const back = finishOAuth({ state: trip.state, cookie: trip.cookie, provider: "google" }, NOW + 60_000, ENV);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state).toMatchObject(who);
    expect(createHash("sha256").update(back.codeVerifier).digest("base64url")).toBe(trip.codeChallenge);
  });

  it("refuses a state somebody edited: another workspace, another person", () => {
    const trip = beginOAuth(who, NOW, ENV);
    const [payload, mac] = trip.state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), tenantId: "t2" }),
    ).toString("base64url");
    expect(finishOAuth({ state: `${forged}.${mac}`, cookie: trip.cookie, provider: "google" }, NOW, ENV)).toEqual({
      ok: false,
      reason: "signature",
    });
    // Signed with another secret is the same as not signed.
    expect(
      finishOAuth({ state: trip.state, cookie: trip.cookie, provider: "google" }, NOW, { AUTH_SECRET: "x" }),
    ).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("⚠️ refuses the answer in another browser: the cookie is what ties it to the one that asked", () => {
    const trip = beginOAuth(who, NOW, ENV);
    const other = beginOAuth(who, NOW, ENV);
    expect(finishOAuth({ state: trip.state, cookie: other.cookie, provider: "google" }, NOW, ENV)).toEqual({
      ok: false,
      reason: "cookie",
    });
    expect(finishOAuth({ state: trip.state, cookie: null, provider: "google" }, NOW, ENV)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("refuses it late, or for the other provider", () => {
    const trip = beginOAuth(who, NOW, ENV);
    expect(finishOAuth({ state: trip.state, cookie: trip.cookie, provider: "google" }, NOW + 11 * 60_000, ENV)).toEqual(
      {
        ok: false,
        reason: "expired",
      },
    );
    expect(finishOAuth({ state: trip.state, cookie: trip.cookie, provider: "microsoft" }, NOW, ENV)).toEqual({
      ok: false,
      reason: "provider",
    });
  });
});

describe("⚠️⚠️ the message sent through Gmail", () => {
  it("has no header nobody wrote: a line break in a subject or a name adds nothing", () => {
    const raw = buildRfc822({
      from: "anna@x.it",
      fromName: "Anna\r\nBcc: spy@evil.test",
      to: ["cliente@y.it"],
      subject: "Offerta\r\nBcc: spy@evil.test",
      html: "<p>Ciao</p>",
    });
    const headers = raw.split("\r\n\r\n")[0].split("\r\n");
    expect(headers.filter((h) => /^bcc:/i.test(h))).toEqual([]);
    expect(headers.every((h) => /^[A-Za-z-]+: /.test(h))).toBe(true);
  });

  it("⚠️⚠️ nor from an address: a recipient is written as it is, so it is where a break would get through", () => {
    const raw = buildRfc822({
      from: "anna@x.it",
      to: ["c@y.it\r\nBcc: spy@evil.test"],
      cc: ["d@y.it\nX-Evil: 1"],
      subject: "s",
      html: "h",
    });
    const headers = raw.split("\r\n\r\n")[0].split("\r\n");
    expect(headers.some((h) => /^(bcc|x-evil):/i.test(h))).toBe(false);
  });

  it("carries accents in the subject and the body, and threads an answer", () => {
    const raw = buildRfc822({
      from: "anna@x.it",
      fromName: "Anna Città",
      to: ["a@y.it", "b@y.it"],
      cc: ["c@y.it"],
      subject: "Perché no?",
      html: "<p>È così</p>",
      inReplyTo: "<abc@mail.y.it>",
    });
    expect(raw).toContain(`Subject: ${encodeWord("Perché no?")}`);
    expect(raw).toContain("To: a@y.it, b@y.it");
    expect(raw).toContain("In-Reply-To: <abc@mail.y.it>");
    expect(raw).toContain("References: <abc@mail.y.it>");
    const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("<p>È così</p>");
  });

  it("base64url both ways, accents included", () => {
    expect(base64UrlDecode(base64UrlEncode("Città ✓"))).toBe("Città ✓");
    expect(base64UrlEncode("??>")).not.toMatch(/[+/=]/);
  });

  it("finds every address in a header, names and quoted commas aside", () => {
    expect(addressesIn('"Rossi, Mario" <Mario@X.it>, b@y.it; <c@z.it>')).toEqual(["mario@x.it", "b@y.it", "c@z.it"]);
    expect(addressesIn(null)).toEqual([]);
    expect(htmlToText("<style>p{}</style><p>Uno<br>due</p><p>tre &amp; quattro</p>")).toBe("Uno\ndue\ntre & quattro");
  });
});

describe("⚠️⚠️ dormant until it may run", () => {
  const google = { MAIL_GOOGLE_CLIENT_ID: "id", MAIL_GOOGLE_CLIENT_SECRET: "secret" };

  it("off without credentials: nothing offered, no client", () => {
    expect(providerState("google", {})).toBe("off");
    expect(providerFor("google", {})).toBeNull();
    expect(mayConnect("google", { isPlatformStaff: true }, {})).toBe(false);
    // Half the credentials is none.
    expect(providerState("google", { MAIL_GOOGLE_CLIENT_ID: "id" })).toBe("off");
  });

  it("⚠️ credentials without the provider's verification: Flux's own staff only", () => {
    expect(providerState("google", google)).toBe("testing");
    expect(mayConnect("google", { isPlatformStaff: false }, google)).toBe(false);
    expect(mayConnect("google", { isPlatformStaff: true }, google)).toBe(true);
  });

  it("verified: anybody, and each provider decides for itself", () => {
    const env = { ...google, MAIL_GOOGLE_VERIFIED: "1" };
    expect(mayConnect("google", { isPlatformStaff: false }, env)).toBe(true);
    expect(providerState("microsoft", env)).toBe("off");
    expect(providerFor("google", env)?.id).toBe("google");
  });
});

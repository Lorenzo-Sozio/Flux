/**
 * ⚠️⚠️ The Aruba client against recorded answers (https://fatturazioneelettronica.aruba.it/apidoc/docs.html).
 *
 * No real Aruba account has been through it: these hold it to the published contract — the
 * credentials in the body, one sign-in reused while it lasts (Aruba allows one a minute), the
 * file base64 of its UTF-8, the status words mapped — so the first real send has only the
 * account itself left to prove.
 */
import { describe, expect, it } from "vitest";

import { arubaProvider, arubaStatus, base64Utf8 } from "./aruba";
import type { HeldToken, SdiContext } from "./types";

type Call = { url: string; method: string; body: string; auth: string | null };

function recorder(answers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      auth: headers.get("Authorization"),
    };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected call ${url}`);
    return answer(call);
  };
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TOKEN = json(200, { access_token: "A1", refresh_token: "R1", expires_in: 1800, token_type: "bearer" });
const NOW = new Date("2026-09-29T10:00:00Z");

function context(fetchImpl: SdiContext["fetch"], token: HeldToken | null = null) {
  const saved: HeldToken[] = [];
  const ctx: SdiContext = {
    environment: "demo",
    username: "flux-user",
    password: "s3cret&x=1",
    accountId: null,
    token,
    fetch: fetchImpl,
    now: () => NOW,
    saveToken: async (t) => {
      saved.push(t);
    },
  };
  return { ctx, saved };
}

const XML = '<?xml version="1.0"?><p:FatturaElettronica>Città di Forlì — €</p:FatturaElettronica>';
/** Aruba takes Flux's file; the invoice's data is for providers that build their own. */
const out = { name: "x.xml", xml: XML, document: {} as never };

describe("⚠️⚠️ signing in", () => {
  it("sends the credentials in the body, never the URL, and keeps the token for the next isolate", async () => {
    const { calls, fetchImpl } = recorder([
      TOKEN,
      json(200, { errorCode: "0000", uploadFileName: "IT01879020517_abcde.xml" }),
    ]);
    const { ctx, saved } = context(fetchImpl);
    const sent = await arubaProvider.send(ctx, out);
    expect(sent).toEqual({ ok: true, fileName: "IT01879020517_abcde.xml" });
    expect(calls[0].url).toBe("https://demoauth.fatturazioneelettronica.aruba.it/auth/signin");
    expect(calls[0].url).not.toContain("s3cret");
    expect(new URLSearchParams(calls[0].body).get("password")).toBe("s3cret&x=1");
    expect(new URLSearchParams(calls[0].body).get("grant_type")).toBe("password");
    expect(saved).toHaveLength(1);
    expect(saved[0].accessExpiresAt.getTime() - NOW.getTime()).toBe(1800_000);
    expect(calls[1].auth).toBe("Bearer A1");
  });

  it("⚠️⚠️ reuses a token still good: one sign-in a minute is all Aruba allows", async () => {
    const { calls, fetchImpl } = recorder([json(200, { errorCode: "0000", uploadFileName: "f.xml" })]);
    const token = {
      accessToken: "HELD",
      accessExpiresAt: new Date(NOW.getTime() + 20 * 60_000),
      refreshToken: null,
      refreshExpiresAt: null,
    };
    const { ctx } = context(fetchImpl, token);
    await arubaProvider.send(ctx, out);
    expect(calls.map((c) => c.url)).toEqual([
      "https://demows.fatturazioneelettronica.aruba.it/services/invoice/upload",
    ]);
    expect(calls[0].auth).toBe("Bearer HELD");
  });

  it("refreshes an expired token with the refresh token, not the password", async () => {
    const { calls, fetchImpl } = recorder([TOKEN, json(200, { errorCode: "0000", uploadFileName: "f.xml" })]);
    const token = {
      accessToken: "OLD",
      accessExpiresAt: new Date(NOW.getTime() - 1000),
      refreshToken: "R0",
      refreshExpiresAt: new Date(NOW.getTime() + 20 * 60_000),
    };
    const { ctx } = context(fetchImpl, token);
    await arubaProvider.send(ctx, out);
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("R0");
    expect(form.get("password")).toBeNull();
  });

  it("signs in again, once, when Aruba no longer accepts the held token", async () => {
    const { calls, fetchImpl } = recorder([
      json(401, { error: "invalid_token" }),
      TOKEN,
      json(200, { errorCode: "0000", uploadFileName: "f.xml" }),
    ]);
    const token = {
      accessToken: "REVOKED",
      accessExpiresAt: new Date(NOW.getTime() + 20 * 60_000),
      refreshToken: null,
      refreshExpiresAt: null,
    };
    const { ctx } = context(fetchImpl, token);
    expect(await arubaProvider.send(ctx, out)).toEqual({ ok: true, fileName: "f.xml" });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer REVOKED", null, "Bearer A1"]);
  });

  it("says the credentials were refused", async () => {
    const { fetchImpl } = recorder([json(401, { error: "invalid_grant" })]);
    const { ctx } = context(fetchImpl);
    expect(await arubaProvider.check(ctx)).toMatchObject({ ok: false, reason: "auth" });
  });
});

describe("⚠️⚠️ handing the file over", () => {
  it("sends the file as base64 of its UTF-8: accents and all", async () => {
    const { calls, fetchImpl } = recorder([TOKEN, json(200, { errorCode: "0000", uploadFileName: "f.xml" })]);
    const { ctx } = context(fetchImpl);
    await arubaProvider.send(ctx, out);
    const body = JSON.parse(calls[1].body);
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.dataFile), (c) => c.charCodeAt(0)))).toBe(XML);
    expect(base64Utf8("è")).toBe("w6g=");
  });

  it("⚠️ Aruba is the transmitter the file must carry", () => {
    expect(arubaProvider.transmitter).toEqual({ country: "IT", code: "01879020517" });
  });

  it("gives Aruba's own words when it refuses the file", async () => {
    const { fetchImpl } = recorder([
      TOKEN,
      json(200, { errorCode: "0094", errorDescription: "La fattura contiene ID trasmittenti differenti da Aruba PEC" }),
    ]);
    const { ctx } = context(fetchImpl);
    expect(await arubaProvider.send(ctx, out)).toEqual({
      ok: false,
      reason: "invalid",
      message: "0094 La fattura contiene ID trasmittenti differenti da Aruba PEC",
    });
  });

  it("tells a busy Aruba from a refusal: 429 is to retry, 5xx is unavailable", async () => {
    const busy = recorder([TOKEN, json(429, {})]);
    expect(await arubaProvider.send(context(busy.fetchImpl).ctx, out)).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
    const down = recorder([TOKEN, json(503, {})]);
    expect(await arubaProvider.send(context(down.fetchImpl).ctx, out)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("⚠️⚠️ what SDI said", () => {
  it("maps every status Aruba documents, and nothing else", () => {
    expect(
      [
        "Presa in carico",
        "Errore elaborazione",
        "Inviata",
        "Scartata",
        "Non consegnata",
        "Recapito impossibile",
        "Consegnata",
        "Accettata",
        "Rifiutata",
        "Decorrenza termini",
      ].map(arubaStatus),
    ).toEqual([
      "pending",
      "error",
      "pending",
      "rejected",
      "not_delivered",
      "not_delivered",
      "delivered",
      "accepted",
      "refused",
      "expired",
    ]);
    expect(arubaStatus(" SCARTATA ")).toBe("rejected");
    expect(arubaStatus("Qualcos'altro")).toBeNull();
  });

  it("reads the status by the file name Aruba gave, with SDI's id and words", async () => {
    const { calls, fetchImpl } = recorder([
      TOKEN,
      json(200, {
        idSdi: "123456789",
        filename: "IT01879020517_abcde.xml",
        invoices: [{ status: "Scartata", statusDescription: "00305 IdCodice del cessionario non valido" }],
      }),
    ]);
    const { ctx } = context(fetchImpl);
    expect(await arubaProvider.status(ctx, { fileName: "IT01879020517_abcde.xml", ref: null, sentAt: null })).toEqual({
      ok: true,
      status: "rejected",
      sdiId: "123456789",
      message: "00305 IdCodice del cessionario non valido",
    });
    expect(calls[1].url).toBe(
      "https://demows.fatturazioneelettronica.aruba.it/services/invoice/out/getByFilename?filename=IT01879020517_abcde.xml&includePdf=false&includeFile=false",
    );
  });

  it("does not invent a status it cannot read", async () => {
    const { fetchImpl } = recorder([TOKEN, json(200, { invoices: [{ status: "Boh" }] })]);
    expect(
      await arubaProvider.status(context(fetchImpl).ctx, { fileName: "f.xml", ref: null, sentAt: null }),
    ).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});

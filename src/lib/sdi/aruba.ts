import {
  type HeldToken,
  type SdiContext,
  SdiHttpError,
  type SdiProvider,
  type SdiStatus,
  type SendOutcome,
  type StatusOutcome,
} from "./types";

/**
 * Aruba's "Fatturazione Elettronica" REST API
 * (https://fatturazioneelettronica.aruba.it/apidoc/docs.html).
 *
 * ⚠️⚠️ **Aruba is the transmitter.** Its synchronous check refuses a file whose `IdTrasmittente`
 * is anything but Aruba PEC S.p.A. (IT01879020517, error 0094): the file sent through Aruba is
 * built with Aruba's code, not the issuer's (`transmitter` below, frozen on the invoice).
 *
 * ⚠️⚠️ **One sign-in per minute per IP**, and a token lasts 30 minutes (its refresh token 60).
 * Workers share IPs and run many isolates, so the token is kept in the workspace's database
 * (`ctx.token` / `ctx.saveToken`, encrypted) and reused until it is about to expire; a
 * sign-in per call would lock the account out at the second invoice.
 *
 * ⚠️ The issuer's VAT number must be associated with the Aruba account (asynchronous error
 * FATRSM205 otherwise), and the account must have the API enabled. Neither can be checked
 * from here before the first real send.
 *
 * ⚠️ **No real Aruba account has been through this.** It is written against the published
 * documentation and tested with recorded answers; the first send on the demo system
 * (`environment: "demo"`) is the first real test.
 */

const BASE = {
  demo: {
    auth: "https://demoauth.fatturazioneelettronica.aruba.it",
    ws: "https://demows.fatturazioneelettronica.aruba.it",
  },
  production: {
    auth: "https://auth.fatturazioneelettronica.aruba.it",
    ws: "https://ws.fatturazioneelettronica.aruba.it",
  },
} as const;

/** A token is renewed this long before it expires: a call must not start with one about to die. */
const EARLY_MS = 60_000;

/** Aruba's status words, and ours. Compared without case or surrounding spaces. */
const STATUSES: Record<string, SdiStatus> = {
  "presa in carico": "pending",
  inviata: "pending",
  "errore elaborazione": "error",
  scartata: "rejected",
  "non consegnata": "not_delivered",
  "recapito impossibile": "not_delivered",
  consegnata: "delivered",
  accettata: "accepted",
  rifiutata: "refused",
  "decorrenza termini": "expired",
};

export function arubaStatus(value: unknown): SdiStatus | null {
  return typeof value === "string" ? (STATUSES[value.trim().toLowerCase()] ?? null) : null;
}

/** UTF-8 text as base64, without Node's Buffer: this runs on Workers. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function call<T>(ctx: SdiContext, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await ctx.fetch(url, init);
  } catch (err) {
    throw new SdiHttpError(`Aruba unreachable: ${err instanceof Error ? err.message : String(err)}`, 0);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // Never the request in the message: it carries the password or the invoice.
    throw new SdiHttpError(`Aruba answered ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface TokenAnswer {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function held(answer: TokenAnswer, now: Date): HeldToken {
  return {
    accessToken: answer.access_token,
    // 30 minutes unless Aruba says otherwise.
    accessExpiresAt: new Date(now.getTime() + (answer.expires_in ?? 1800) * 1000),
    refreshToken: answer.refresh_token ?? null,
    refreshExpiresAt: answer.refresh_token ? new Date(now.getTime() + 60 * 60_000) : null,
  };
}

async function signIn(ctx: SdiContext, form: Record<string, string>): Promise<HeldToken> {
  const now = ctx.now?.() ?? new Date();
  const answer = await call<TokenAnswer>(ctx, `${BASE[ctx.environment].auth}/auth/signin`, {
    method: "POST",
    // In the body, never the query string: Aruba's own rule, and a URL ends up in logs.
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(form).toString(),
  });
  if (!answer?.access_token) throw new SdiHttpError("Aruba answered the sign-in without a token", 401);
  const token = held(answer, now);
  await ctx.saveToken(token);
  return token;
}

/** A token that is still good: the one held, a refreshed one, or a new sign-in — in that order. */
async function accessToken(ctx: SdiContext, forceNew = false): Promise<string> {
  const now = (ctx.now?.() ?? new Date()).getTime();
  const t = ctx.token;
  if (!forceNew && t && t.accessExpiresAt.getTime() - EARLY_MS > now) return t.accessToken;
  if (!forceNew && t?.refreshToken && t.refreshExpiresAt && t.refreshExpiresAt.getTime() - EARLY_MS > now) {
    try {
      const fresh = await signIn(ctx, { grant_type: "refresh_token", refresh_token: t.refreshToken });
      ctx.token = fresh;
      return fresh.accessToken;
    } catch (err) {
      if (!(err instanceof SdiHttpError) || (err.status !== 400 && err.status !== 401)) throw err;
      // A refused refresh token: sign in again with the credentials.
    }
  }
  const fresh = await signIn(ctx, { grant_type: "password", username: ctx.username, password: ctx.password });
  ctx.token = fresh;
  return fresh.accessToken;
}

/** One authenticated call; a token Aruba no longer accepts is renewed once. */
async function authed<T>(ctx: SdiContext, url: string, init: RequestInit): Promise<T> {
  const attempt = async (forceNew: boolean) => {
    const token = await accessToken(ctx, forceNew);
    return call<T>(ctx, url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
  };
  try {
    return await attempt(false);
  } catch (err) {
    if (err instanceof SdiHttpError && err.status === 401) return attempt(true);
    throw err;
  }
}

function failure(err: unknown): { reason: "auth" | "unavailable" | "rate_limited"; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SdiHttpError) {
    if (err.status === 401 || err.status === 403) return { reason: "auth", message };
    if (err.status === 429) return { reason: "rate_limited", message };
  }
  return { reason: "unavailable", message };
}

interface UploadAnswer {
  errorCode?: string | null;
  errorDescription?: string | null;
  uploadFileName?: string | null;
}

interface InvoiceOut {
  idSdi?: string | null;
  status?: string | null;
  statusDescription?: string | null;
  invoices?: { status?: string | null; statusDescription?: string | null }[] | null;
}

export const arubaProvider: SdiProvider = {
  id: "aruba",
  label: "Aruba",
  credentials: ["username", "password"],
  hasDemo: true,
  transmitter: { country: "IT", code: "01879020517" },

  async check(ctx) {
    try {
      // A sign-in with the credentials as typed, never the held token: this is what checks them.
      await signIn(ctx, { grant_type: "password", username: ctx.username, password: ctx.password });
      return { ok: true };
    } catch (err) {
      const f = failure(err);
      return { ok: false, reason: f.reason === "auth" ? "auth" : "unavailable", message: f.message };
    }
  },

  async send(ctx, file): Promise<SendOutcome> {
    let answer: UploadAnswer;
    try {
      answer = await authed<UploadAnswer>(ctx, `${BASE[ctx.environment].ws}/services/invoice/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: JSON.stringify({ dataFile: base64Utf8(file.xml), credential: "", domain: "" }),
      });
    } catch (err) {
      // A 400 with a body is Aruba refusing the file itself: its code is the useful part.
      if (err instanceof SdiHttpError && err.status === 400)
        return { ok: false, reason: "invalid", message: err.message };
      return { ok: false, ...failure(err) };
    }
    const code = answer.errorCode ?? "";
    if (code && code !== "0000") {
      return { ok: false, reason: "invalid", message: `${code} ${answer.errorDescription ?? ""}`.trim() };
    }
    if (!answer.uploadFileName) {
      return { ok: false, reason: "unavailable", message: "Aruba took the file without naming it" };
    }
    return { ok: true, fileName: answer.uploadFileName };
  },

  async status(ctx, sent): Promise<StatusOutcome> {
    const fileName = sent.fileName;
    if (!fileName) return { ok: false, reason: "not_found", message: "No file name to ask Aruba about" };
    let answer: InvoiceOut;
    try {
      const query = new URLSearchParams({ filename: fileName, includePdf: "false", includeFile: "false" });
      answer = await authed<InvoiceOut>(
        ctx,
        `${BASE[ctx.environment].ws}/services/invoice/out/getByFilename?${query.toString()}`,
        { method: "GET" },
      );
    } catch (err) {
      if (err instanceof SdiHttpError && err.status === 404)
        return { ok: false, reason: "not_found", message: err.message };
      return { ok: false, ...failure(err) };
    }
    const first = answer.invoices?.[0];
    const status = arubaStatus(first?.status ?? answer.status);
    if (!status) {
      return { ok: false, reason: "unavailable", message: `Unknown Aruba status: ${first?.status ?? answer.status}` };
    }
    return {
      ok: true,
      status,
      sdiId: answer.idSdi ?? null,
      message: first?.statusDescription ?? answer.statusDescription ?? null,
    };
  },
};

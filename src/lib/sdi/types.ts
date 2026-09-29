/**
 * Transmitting an issued invoice to SDI through an intermediary, whichever one the workspace uses.
 *
 * Flux does not talk to SDI itself: like every CRM that issues Italian e-invoices, it hands the
 * FatturaPA file to an accredited intermediary (Aruba first) and reads back what SDI said. One
 * shape for every intermediary, so the sending, the status polling, the screens and the tests
 * are written once — a new intermediary is one file implementing `SdiProvider` and one line in
 * ./registry.ts.
 *
 * ⚠️ Everything here is plain `fetch`: it runs on Workers, and a test hands in its own.
 */

import type { XmlInvoice } from "@/lib/fatturapa/xml";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The intermediaries a workspace can choose. "manual" is not one: the file is downloaded and sent by hand. */
export type SdiProviderId = "aruba" | "fattureincloud";
export const SDI_PROVIDER_IDS: readonly SdiProviderId[] = ["aruba", "fattureincloud"];
export type SdiChannel = "manual" | SdiProviderId;

/** The intermediary's test system, or the real one. */
export type SdiEnvironment = "demo" | "production";

/**
 * Where an invoice stands with SDI, the same words whichever intermediary said it.
 *
 * - `sending` — claimed by a request that is handing it over right now;
 * - `send_failed` — the intermediary did not take it (credentials, validation, unreachable): nothing reached SDI;
 * - `pending` — taken by the intermediary, on its way to SDI or waiting for SDI's answer;
 * - `error` — the intermediary could not process it after taking it;
 * - `rejected` — SDI discarded it (scartata): **for the tax authority it was never issued**;
 * - `not_delivered` — SDI could not deliver it (mancata consegna): valid, in the customer's
 *   tax drawer, and the customer must be told;
 * - `delivered` — delivered to the customer;
 * - `accepted` / `refused` — a public administration's answer;
 * - `expired` — a public administration did not answer within 15 days (decorrenza termini);
 * - `sent_manually` — the workspace says it sent the file itself.
 */
export type SdiStatus =
  | "sending"
  | "send_failed"
  | "pending"
  | "error"
  | "rejected"
  | "not_delivered"
  | "delivered"
  | "accepted"
  | "refused"
  | "expired"
  | "sent_manually";

/** IdTrasmittente: who hands the file to SDI. */
export interface Transmitter {
  country: string;
  code: string;
}

/** A token the intermediary issued, kept (encrypted) in the workspace so every isolate shares it. */
export interface HeldToken {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string | null;
  refreshExpiresAt: Date | null;
}

/** What a provider needs to act for the workspace. */
export interface SdiContext {
  environment: SdiEnvironment;
  /** Empty for a provider that signs in with a token alone. */
  username: string;
  /** The account's password, or its access token (`credentials` says which). */
  password: string;
  /** The account inside the provider the invoices belong to (Fatture in Cloud's company id). */
  accountId: string | null;
  /** The token held from an earlier call, if any. */
  token: HeldToken | null;
  /** Keeps a new token for the next call — and the next isolate. */
  saveToken: (token: HeldToken) => Promise<void>;
  fetch: FetchLike;
  now?: () => Date;
}

/** One issued invoice, as it goes to the provider: the file Flux built, and the data it was built from. */
export interface OutgoingInvoice {
  /** SDI's file name for Flux's file. */
  name: string;
  /** The FatturaPA file Flux built from the frozen snapshots. */
  xml: string;
  /** The same invoice as data, for a provider that builds its own file (Fatture in Cloud). */
  document: XmlInvoice & { number: number | null; series: string };
}

export type SendOutcome =
  | {
      ok: true;
      /** The intermediary's name for the file. */
      fileName: string;
      /** The intermediary's own id for what it holds (Fatture in Cloud's document id), when it has one. */
      ref?: string | null;
      /**
       * ⚠️ The file that actually went to SDI, when the intermediary built it: Flux keeps and serves
       * it, so the XML downloaded is the XML sent.
       */
      sentXml?: string | null;
    }
  | {
      ok: false;
      /**
       * - `auth` — the credentials were refused;
       * - `invalid` — the file was refused before SDI (validation, transmitter, VAT not associated);
       * - `unavailable` — the intermediary did not answer or answered 5xx; retry later;
       * - `rate_limited` — too many calls: retry later.
       */
      reason: "auth" | "invalid" | "unavailable" | "rate_limited";
      /** The intermediary's own words, shown to the person: they are what tells them what to fix. */
      message: string;
    };

export type StatusOutcome =
  | { ok: true; status: SdiStatus; sdiId: string | null; message: string | null }
  | { ok: false; reason: "auth" | "not_found" | "unavailable" | "rate_limited"; message: string };

/** What the settings screen asks for: the fields this provider signs in with. */
export type SdiCredential = "username" | "password" | "token" | "accountId";

export interface SdiProvider {
  id: SdiProviderId;
  /** The name shown in settings. */
  label: string;
  /** The fields the settings ask for. "password" and "token" are both kept, encrypted, in one column. */
  credentials: readonly SdiCredential[];
  /** Whether the provider has a test system Flux can point at. */
  hasDemo: boolean;
  /**
   * The IdTrasmittente the intermediary requires in Flux's file, or null when it builds its own
   * file (Fatture in Cloud) or the issuer transmits under its own code. ⚠️ Aruba refuses a file
   * whose transmitter is not Aruba (error 0094).
   */
  transmitter: Transmitter | null;
  /**
   * Checks the credentials without sending anything. `accounts` lists the accounts the token
   * reaches, for a provider where one must be chosen.
   */
  check(
    ctx: SdiContext,
  ): Promise<
    | { ok: true; accounts?: { id: string; name: string }[] }
    | { ok: false; reason: "auth" | "unavailable" | "account"; message: string }
  >;
  /** Hands one issued invoice over. */
  send(ctx: SdiContext, invoice: OutgoingInvoice): Promise<SendOutcome>;
  /** What SDI said about an invoice handed over earlier. */
  status(
    ctx: SdiContext,
    sent: { fileName: string | null; ref: string | null; sentAt: Date | null },
  ): Promise<StatusOutcome>;
}

/** A call the intermediary answered with an error status. */
export class SdiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SdiHttpError";
  }
}

/**
 * A person's own mailbox and calendar, at Google or Microsoft (V3.2, decision D-B).
 *
 * One shape for both, so everything above it — connecting, sending, filing what arrives,
 * mirroring appointments, reading busy time — is written once and does not know which
 * company holds the mailbox.
 *
 * ⚠️⚠️ **Dormant until it may run.** A provider is available only when its credentials are
 * set *and* the deployment declares it verified by the provider (Google's review of the
 * restricted Gmail scopes, Microsoft's publisher verification). Before that, nothing here is
 * reachable by a customer; see `providerState` in ./registry.ts.
 *
 * ⚠️ Everything here is plain `fetch`: it runs on Workers, and a test hands in its own.
 */

export type MailProviderId = "google" | "microsoft";

export const MAIL_PROVIDER_IDS: readonly MailProviderId[] = ["google", "microsoft"];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TokenSet {
  accessToken: string;
  /** Absent when the provider did not rotate it: keep the one held. */
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

export interface Mailbox {
  /** The address the mailbox sends as. */
  email: string;
}

export interface OutgoingMail {
  from: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  /** Answering a message: its Message-ID, so the reply lands in the same thread. */
  inReplyTo?: string | null;
}

export interface SentMail {
  /** The provider's own id for the message. */
  providerId: string;
  /** RFC 5322 Message-ID, when the provider tells it: what an answer will quote. */
  messageId: string | null;
  threadId: string | null;
}

/** One message as the CRM needs it, whichever way it went. */
export interface SyncedMessage {
  providerId: string;
  /** RFC 5322 Message-ID, the key a message is filed once by. */
  messageId: string;
  threadId: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  date: Date;
}

export interface MessagePage {
  messages: SyncedMessage[];
  /** Where the next read starts. */
  cursor: string;
  /** More is waiting beyond this page. */
  more: boolean;
  /** Requests made to read it, beyond the first: what the run's budget is charged. */
  calls?: number;
}

export interface BusyBlock {
  start: Date;
  end: Date;
}

export interface CalendarEvent {
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  /** The workspace's zone, so an all-day event is the right day. */
  timeZone: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** The provider's HTTP status; 401/403 after a refresh means the grant is gone. */
    readonly status: number,
    /** The read cursor is no longer valid and must be taken again from now. */
    readonly cursorExpired = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface MailProvider {
  id: MailProviderId;
  /** What the consent screen asks for. */
  scopes: readonly string[];
  authorizeUrl(input: { state: string; redirectUri: string; codeChallenge: string; loginHint?: string }): string;
  exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  /** Best effort: a revoke that fails leaves a grant the person can remove at the provider. */
  revoke(token: string): Promise<void>;
  mailbox(accessToken: string): Promise<Mailbox>;
  send(accessToken: string, mail: OutgoingMail): Promise<SentMail>;
  /** Where reading starts for a newly connected mailbox: now, never the backlog. */
  startCursor(accessToken: string, now: Date): Promise<string>;
  /** Messages after `cursor`, at most `limit`. */
  messagesSince(accessToken: string, cursor: string, limit: number): Promise<MessagePage>;
  busy(accessToken: string, from: Date, to: Date): Promise<BusyBlock[]>;
  createEvent(accessToken: string, event: CalendarEvent): Promise<string>;
  updateEvent(accessToken: string, externalId: string, event: CalendarEvent): Promise<void>;
  deleteEvent(accessToken: string, externalId: string): Promise<void>;
}

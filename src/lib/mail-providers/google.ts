/**
 * Gmail and Google Calendar behind the common shape (./types.ts).
 *
 * ⚠️ Written against the documented APIs and exercised only with recorded responses in
 * tests: until a verified client exists, no real mailbox has been through it.
 *
 * - Reading follows Gmail's history from the moment of connection — never the backlog —
 *   and keeps only what is in the inbox or was sent: drafts, spam and chats are not mail
 *   anybody exchanged with a customer.
 * - A history id too old for Gmail answers 404: the cursor is taken again from now.
 */
import { toWallDate } from "@/lib/wall-clock";

import { callJson, tokenSet } from "./http";
import { addressesIn, base64UrlBytes, base64UrlDecode, base64UrlEncode, buildRfc822, clip, htmlToText } from "./mime";
import {
  type CalendarEvent,
  type FetchLike,
  type MailProvider,
  type MessagePage,
  ProviderError,
  type SyncedMessage,
} from "./types";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
] as const;

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

/**
 * A part's text in the charset it declares: Gmail undoes the transfer encoding but not the
 * character set, and a Latin-1 message read as UTF-8 arrives with every accent broken.
 */
function decodePart(part: GmailPart): string {
  const type = part.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const charset = /charset="?([^";\s]+)/i.exec(type)?.[1]?.toLowerCase();
  const data = part.body?.data ?? "";
  if (!charset || charset === "utf-8" || charset === "us-ascii") return base64UrlDecode(data);
  try {
    return new TextDecoder(charset).decode(base64UrlBytes(data));
  } catch {
    // A charset this runtime does not know: UTF-8 is the likeliest reading.
    return base64UrlDecode(data);
  }
}

function findPart(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return decodePart(part);
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found !== null) return found;
  }
  return null;
}

/** A Gmail message as the CRM files it; null for what is not mail between people. */
export function readGmailMessage(m: GmailMessage): SyncedMessage | null {
  const labels = m.labelIds ?? [];
  if (!labels.includes("INBOX") && !labels.includes("SENT")) return null;
  if (labels.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH")) return null;
  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
  const from = addressesIn(header("From"))[0];
  if (!from) return null;
  const plain = findPart(m.payload, "text/plain");
  const html = plain === null ? findPart(m.payload, "text/html") : null;
  return {
    providerId: m.id,
    messageId: (header("Message-ID") ?? `gmail:${m.id}`).replace(/^<|>$/g, "").trim(),
    threadId: m.threadId ?? null,
    from,
    to: addressesIn(header("To")),
    cc: addressesIn(header("Cc")),
    subject: header("Subject") ?? "",
    text: clip((plain ?? (html !== null ? htmlToText(html) : (m.snippet ?? ""))).trim()),
    date: m.internalDate ? new Date(Number(m.internalDate)) : new Date(header("Date") ?? Date.now()),
  };
}

function eventBody(e: CalendarEvent) {
  const when = (d: Date) => (e.allDay ? { date: toWallDate(d, e.timeZone) } : { dateTime: d.toISOString() });
  return {
    summary: e.title,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    // Free for an all-day one: availability skips it here, and marked busy it came back from
    // Google as a whole day taken, closing the booking page for it.
    ...(e.allDay ? { transparency: "transparent" } : {}),
    start: when(e.start),
    end: when(e.end),
  };
}

export function googleProvider(
  credentials: { clientId: string; clientSecret: string },
  fetchImpl: FetchLike = fetch,
): MailProvider {
  const token = async (form: Record<string, string>) =>
    tokenSet(
      await callJson(fetchImpl, "Google token", TOKEN, {
        form: { client_id: credentials.clientId, client_secret: credentials.clientSecret, ...form },
      }),
    );

  return {
    id: "google",
    scopes: GOOGLE_SCOPES,

    authorizeUrl({ state, redirectUri, codeChallenge, loginHint }) {
      const q = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        // A refresh token, and the consent screen every time so it is always issued.
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        ...(loginHint ? { login_hint: loginHint } : {}),
      });
      return `${AUTH}?${q.toString()}`;
    },

    exchangeCode: ({ code, redirectUri, codeVerifier }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),

    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),

    async revoke(t) {
      await callJson(fetchImpl, "Google revoke", "https://oauth2.googleapis.com/revoke", { form: { token: t } });
    },

    async mailbox(accessToken) {
      const p = await callJson<{ emailAddress: string }>(fetchImpl, "Gmail profile", `${GMAIL}/profile`, {
        token: accessToken,
      });
      return { email: p.emailAddress.toLowerCase() };
    },

    async send(accessToken, mail) {
      const sent = await callJson<{ id: string; threadId?: string }>(
        fetchImpl,
        "Gmail send",
        `${GMAIL}/messages/send`,
        {
          token: accessToken,
          json: { raw: base64UrlEncode(buildRfc822(mail)) },
        },
      );
      // Gmail writes the Message-ID itself; one read tells it, and an answer quotes it.
      let messageId: string | null = null;
      try {
        const m = await callJson<GmailMessage>(
          fetchImpl,
          "Gmail message",
          `${GMAIL}/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
          { token: accessToken },
        );
        messageId =
          m.payload?.headers
            ?.find((h) => h.name.toLowerCase() === "message-id")
            ?.value.replace(/^<|>$/g, "")
            .trim() ?? null;
      } catch {
        // Sent is sent; without the id the answer is filed by its sender instead.
      }
      return { providerId: sent.id, messageId, threadId: sent.threadId ?? null };
    },

    async startCursor(accessToken) {
      const p = await callJson<{ historyId: string }>(fetchImpl, "Gmail profile", `${GMAIL}/profile`, {
        token: accessToken,
      });
      return String(p.historyId);
    },

    async messagesSince(accessToken, cursor, limit): Promise<MessagePage> {
      const q = new URLSearchParams({ startHistoryId: cursor, historyTypes: "messageAdded", maxResults: "100" });
      let history: {
        history?: { id: string; messagesAdded?: { message: GmailMessage }[] }[];
        historyId: string;
        nextPageToken?: string;
      };
      try {
        history = await callJson(fetchImpl, "Gmail history", `${GMAIL}/history?${q.toString()}`, {
          token: accessToken,
        });
      } catch (err) {
        if (err instanceof ProviderError && err.status === 404) {
          throw new ProviderError("Gmail history cursor expired", 404, true);
        }
        throw err;
      }

      const ids: string[] = [];
      let next = cursor;
      let more = Boolean(history.nextPageToken);
      for (const record of history.history ?? []) {
        const added = (record.messagesAdded ?? [])
          .map((a) => a.message)
          .filter((m) => !(m.labelIds ?? []).some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH"))
          .map((m) => m.id)
          .filter((id) => !ids.includes(id));
        // Stop before a record that does not fit, so the next read starts at it.
        if (ids.length > 0 && ids.length + added.length > limit) {
          more = true;
          break;
        }
        ids.push(...added);
        next = record.id;
      }
      // Everything on the page was read: the mailbox's own history id is the next start.
      if (!more) next = String(history.historyId);

      const messages: SyncedMessage[] = [];
      for (const id of ids) {
        try {
          const m = await callJson<GmailMessage>(fetchImpl, "Gmail message", `${GMAIL}/messages/${id}?format=full`, {
            token: accessToken,
          });
          const read = readGmailMessage(m);
          if (read) messages.push(read);
        } catch (err) {
          // Deleted between the history and the read: nothing to file.
          if (!(err instanceof ProviderError && err.status === 404)) throw err;
        }
      }
      // Each message is one read of its own.
      return { messages, cursor: next, more, calls: ids.length };
    },

    async busy(accessToken, from, to) {
      const r = await callJson<{ calendars?: { primary?: { busy?: { start: string; end: string }[] } } }>(
        fetchImpl,
        "Google free/busy",
        `${CALENDAR}/freeBusy`,
        {
          token: accessToken,
          json: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
        },
      );
      return (r.calendars?.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    },

    async createEvent(accessToken, event) {
      const r = await callJson<{ id: string }>(fetchImpl, "Google event", `${CALENDAR}/calendars/primary/events`, {
        token: accessToken,
        json: eventBody(event),
      });
      return r.id;
    },

    async updateEvent(accessToken, externalId, event) {
      await callJson(
        fetchImpl,
        "Google event",
        `${CALENDAR}/calendars/primary/events/${encodeURIComponent(externalId)}`,
        {
          method: "PATCH",
          token: accessToken,
          json: eventBody(event),
        },
      );
    },

    async deleteEvent(accessToken, externalId) {
      try {
        await callJson(
          fetchImpl,
          "Google event",
          `${CALENDAR}/calendars/primary/events/${encodeURIComponent(externalId)}`,
          {
            method: "DELETE",
            token: accessToken,
          },
        );
      } catch (err) {
        // Already gone at Google is what deleting wanted.
        if (!(err instanceof ProviderError && (err.status === 404 || err.status === 410))) throw err;
      }
    },
  };
}

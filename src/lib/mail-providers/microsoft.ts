/**
 * Outlook mail and calendar (Microsoft Graph) behind the common shape (./types.ts).
 *
 * ⚠️ Written against the documented APIs and exercised only with recorded responses in
 * tests: until a verified app registration exists, no real mailbox has been through it.
 *
 * - Reading takes the inbox and sent items, each from its own point in time, oldest first;
 *   the cursor is both instants. `ge`, not `gt`: two messages in the same second must not
 *   lose one, and the one read twice is filed once (the filing is keyed by Message-ID).
 * - A reply is created from the original message when the mailbox still has it, which is
 *   the only way Graph threads it: In-Reply-To cannot be set by hand.
 * - Microsoft has no endpoint to revoke one app's grant; disconnecting forgets the tokens,
 *   and the person removes the app at myapps.microsoft.com if they want it gone there too.
 */
import { toWallDate } from "@/lib/wall-clock";

import { callJson, tokenSet } from "./http";
import { clip, htmlToText } from "./mime";
import {
  type BusyBlock,
  type CalendarEvent,
  type FetchLike,
  type MailProvider,
  type MessagePage,
  ProviderError,
  type SyncedMessage,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * An OData query string. ⚠️ Not URLSearchParams: it writes a space as "+" and "$" as "%24",
 * and OData reads "+" as a plus — "receivedDateTime+ge+…" is not a filter Graph understands.
 */
export function odata(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

export const MICROSOFT_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
  "Mail.Read",
  // ⚠️⚠️ Sending creates a draft first (the only way to learn its Message-ID, and the only way
  // to answer inside a thread), and a draft needs ReadWrite: with Mail.Send alone every send
  // from an Outlook mailbox was a 403.
  "Mail.ReadWrite",
  "Calendars.ReadWrite",
] as const;

interface GraphAddress {
  emailAddress?: { address?: string; name?: string };
}
interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  subject?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime?: string;
  isDraft?: boolean;
}

const addr = (a: GraphAddress | undefined) => a?.emailAddress?.address?.toLowerCase() ?? null;
const recipients = (xs: string[] | undefined) => (xs ?? []).map((address) => ({ emailAddress: { address } }));

/** A Graph message as the CRM files it; null for a draft or a message with no sender. */
export function readGraphMessage(m: GraphMessage): SyncedMessage | null {
  if (m.isDraft) return null;
  const from = addr(m.from);
  if (!from) return null;
  const content = m.body?.content ?? "";
  return {
    providerId: m.id,
    messageId: (m.internetMessageId ?? `graph:${m.id}`).replace(/^<|>$/g, "").trim(),
    threadId: m.conversationId ?? null,
    from,
    to: (m.toRecipients ?? []).map(addr).filter((a): a is string => Boolean(a)),
    cc: (m.ccRecipients ?? []).map(addr).filter((a): a is string => Boolean(a)),
    subject: m.subject ?? "",
    text: clip((m.body?.contentType === "html" ? htmlToText(content) : content).trim()),
    date: new Date(m.receivedDateTime ?? Date.now()),
  };
}

/** Graph writes UTC as a bare "2026-09-28T09:00:00.0000000" when asked for UTC. */
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

function eventBody(e: CalendarEvent) {
  const when = (d: Date) =>
    e.allDay
      ? { dateTime: `${toWallDate(d, e.timeZone)}T00:00:00`, timeZone: e.timeZone }
      : { dateTime: d.toISOString().slice(0, 19), timeZone: "UTC" };
  return {
    subject: e.title,
    body: { contentType: "text", content: e.description ?? "" },
    ...(e.location ? { location: { displayName: e.location } } : {}),
    isAllDay: e.allDay,
    // An all-day appointment does not make the person unavailable in Flux (availability skips
    // it), so it must not come back from their calendar as a whole day taken either.
    ...(e.allDay ? { showAs: "free" } : {}),
    start: when(e.start),
    end: when(e.end),
  };
}

interface Cursor {
  inbox: string;
  sent: string;
}

export function microsoftProvider(
  credentials: { clientId: string; clientSecret: string; tenant?: string },
  fetchImpl: FetchLike = fetch,
): MailProvider {
  const base = `https://login.microsoftonline.com/${credentials.tenant || "common"}/oauth2/v2.0`;
  const token = async (form: Record<string, string>) =>
    tokenSet(
      await callJson(fetchImpl, "Microsoft token", `${base}/token`, {
        form: {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scope: MICROSOFT_SCOPES.join(" "),
          ...form,
        },
      }),
    );
  const text = { Prefer: 'outlook.body-content-type="text"' };

  async function folder(accessToken: string, name: "inbox" | "sentitems", since: string, top: number) {
    const q = odata({
      $filter: `receivedDateTime ge ${since}`,
      $orderby: "receivedDateTime asc",
      $top: String(top),
      $select:
        "id,internetMessageId,conversationId,from,toRecipients,ccRecipients,subject,body,receivedDateTime,isDraft",
    });
    const r = await callJson<{ value: GraphMessage[] }>(
      fetchImpl,
      "Graph messages",
      `${GRAPH}/me/mailFolders/${name}/messages?${q}`,
      { token: accessToken, headers: text },
    );
    return r.value ?? [];
  }

  return {
    id: "microsoft",
    scopes: MICROSOFT_SCOPES,

    authorizeUrl({ state, redirectUri, codeChallenge, loginHint }) {
      const q = new URLSearchParams({
        client_id: credentials.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: MICROSOFT_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
        ...(loginHint ? { login_hint: loginHint } : {}),
      });
      return `${base}/authorize?${q.toString()}`;
    },

    exchangeCode: ({ code, redirectUri, codeVerifier }) =>
      token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),

    // ⚠️ Microsoft rotates the refresh token: the new one must replace the old.
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),

    async revoke() {
      // Nothing to call: see the note at the top.
    },

    async mailbox(accessToken) {
      const me = await callJson<{ mail?: string | null; userPrincipalName: string }>(
        fetchImpl,
        "Graph me",
        `${GRAPH}/me?$select=mail,userPrincipalName`,
        { token: accessToken },
      );
      return { email: (me.mail ?? me.userPrincipalName).toLowerCase() };
    },

    async send(accessToken, mail) {
      const message = {
        subject: mail.subject,
        body: { contentType: "HTML", content: mail.html },
        toRecipients: recipients(mail.to),
        ccRecipients: recipients(mail.cc),
        bccRecipients: recipients(mail.bcc),
      };
      let draft: GraphMessage | null = null;
      if (mail.inReplyTo) {
        const id = `<${mail.inReplyTo.replace(/^<|>$/g, "")}>`.replace(/'/g, "''");
        const found = await callJson<{ value: { id: string }[] }>(
          fetchImpl,
          "Graph find",
          `${GRAPH}/me/messages?$filter=${encodeURIComponent(`internetMessageId eq '${id}'`)}&$select=id&$top=1`,
          { token: accessToken },
        ).catch(() => ({ value: [] }));
        if (found.value[0]) {
          const reply = await callJson<GraphMessage>(
            fetchImpl,
            "Graph reply",
            `${GRAPH}/me/messages/${found.value[0].id}/createReply`,
            { token: accessToken, method: "POST" },
          );
          draft = await callJson<GraphMessage>(fetchImpl, "Graph draft", `${GRAPH}/me/messages/${reply.id}`, {
            method: "PATCH",
            token: accessToken,
            json: message,
          });
        }
      }
      draft ??= await callJson<GraphMessage>(fetchImpl, "Graph draft", `${GRAPH}/me/messages`, {
        token: accessToken,
        json: message,
      });
      await callJson(fetchImpl, "Graph send", `${GRAPH}/me/messages/${draft.id}/send`, {
        token: accessToken,
        method: "POST",
      });
      return {
        providerId: draft.id,
        messageId: draft.internetMessageId?.replace(/^<|>$/g, "").trim() ?? null,
        threadId: draft.conversationId ?? null,
      };
    },

    async startCursor(_accessToken, now) {
      const at = now.toISOString();
      return JSON.stringify({ inbox: at, sent: at } satisfies Cursor);
    },

    async messagesSince(accessToken, cursor, limit): Promise<MessagePage> {
      let c: Cursor;
      try {
        c = JSON.parse(cursor) as Cursor;
        if (!c.inbox || !c.sent) throw new Error("shape");
      } catch {
        throw new ProviderError("Graph cursor unreadable", 400, true);
      }
      const each = Math.max(1, Math.ceil(limit / 2));
      const [inbox, sent] = [
        await folder(accessToken, "inbox", c.inbox, each),
        await folder(accessToken, "sentitems", c.sent, each),
      ];
      const lastAt = (xs: GraphMessage[], fallback: string) => xs.at(-1)?.receivedDateTime ?? fallback;
      const messages = [...inbox, ...sent].map(readGraphMessage).filter((m): m is SyncedMessage => m !== null);
      return {
        messages,
        cursor: JSON.stringify({ inbox: lastAt(inbox, c.inbox), sent: lastAt(sent, c.sent) } satisfies Cursor),
        more: inbox.length >= each || sent.length >= each,
        // The second folder is the one request beyond the first.
        calls: 1,
      };
    },

    async busy(accessToken, from, to) {
      const blocks: BusyBlock[] = [];
      const q = odata({
        startDateTime: from.toISOString(),
        endDateTime: to.toISOString(),
        $select: "start,end,showAs,isCancelled",
        $top: "200",
      });
      let url: string | undefined = `${GRAPH}/me/calendarView?${q}`;
      // Three pages is six hundred events in the window: more than anybody's month.
      for (let page = 0; url && page < 3; page++) {
        const r: {
          value: { start: { dateTime: string }; end: { dateTime: string }; showAs?: string; isCancelled?: boolean }[];
          "@odata.nextLink"?: string;
        } = await callJson(fetchImpl, "Graph calendar", url, {
          token: accessToken,
          headers: { Prefer: 'outlook.timezone="UTC"' },
        });
        for (const e of r.value ?? []) {
          if (e.isCancelled || e.showAs === "free" || e.showAs === "workingElsewhere") continue;
          blocks.push({ start: utc(e.start.dateTime), end: utc(e.end.dateTime) });
        }
        url = r["@odata.nextLink"];
      }
      return blocks;
    },

    async createEvent(accessToken, event) {
      const r = await callJson<{ id: string }>(fetchImpl, "Graph event", `${GRAPH}/me/events`, {
        token: accessToken,
        json: eventBody(event),
      });
      return r.id;
    },

    async updateEvent(accessToken, externalId, event) {
      await callJson(fetchImpl, "Graph event", `${GRAPH}/me/events/${encodeURIComponent(externalId)}`, {
        method: "PATCH",
        token: accessToken,
        json: eventBody(event),
      });
    },

    async deleteEvent(accessToken, externalId) {
      try {
        await callJson(fetchImpl, "Graph event", `${GRAPH}/me/events/${encodeURIComponent(externalId)}`, {
          method: "DELETE",
          token: accessToken,
        });
      } catch (err) {
        if (!(err instanceof ProviderError && err.status === 404)) throw err;
      }
    },
  };
}

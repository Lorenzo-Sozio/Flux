/**
 * The two provider clients against recorded answers: what each sends, and how each reads
 * what comes back. No network — a real mailbox has not been through these yet, and the
 * point of these tests is that the shapes documented by Google and Microsoft are the ones
 * the code writes and reads.
 */
import { describe, expect, it } from "vitest";

import { googleProvider, readGmailMessage } from "./google";
import { microsoftProvider, readGraphMessage } from "./microsoft";
import { base64UrlDecode, base64UrlEncode } from "./mime";
import { ProviderError } from "./types";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

function fakeFetch(routes: [RegExp, (call: Call) => unknown | Response][]) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const call = {
      url: input,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    const route = routes.find(([re]) => re.test(`${call.method} ${input}`));
    if (!route) return new Response("no route", { status: 500 });
    const out = route[1](call);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  };
  return { fetchImpl, calls };
}

const creds = { clientId: "cid", clientSecret: "csecret" };
const part = (mimeType: string, text: string) => ({ mimeType, body: { data: base64UrlEncode(text) } });

describe("Google", () => {
  it("asks for offline access, with PKCE, and the consent screen every time", () => {
    const url = new URL(
      googleProvider(creds).authorizeUrl({ state: "st", redirectUri: "https://crm.x/cb", codeChallenge: "ch" }),
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "cid",
      redirect_uri: "https://crm.x/cb",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.send");
  });

  it("redeems the code with the verifier, and reads the expiry a minute early", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/POST https:\/\/oauth2/, () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b" })],
    ]);
    const before = Date.now();
    const t = await googleProvider(creds, fetchImpl).exchangeCode({ code: "c", redirectUri: "r", codeVerifier: "v" });
    expect(new URLSearchParams(calls[0].body).get("code_verifier")).toBe("v");
    expect(new URLSearchParams(calls[0].body).get("grant_type")).toBe("authorization_code");
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt", scopes: ["a", "b"] });
    expect(t.expiresAt.getTime()).toBeLessThanOrEqual(before + 3540_000 + 1000);
  });

  it("⚠️ keeps what was exchanged with people, as text: never drafts, spam or a message with no sender", () => {
    const base = {
      id: "m1",
      threadId: "t1",
      internalDate: String(Date.parse("2026-09-27T09:00:00Z")),
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: "Mario Rossi <Mario@Cliente.it>" },
          { name: "To", value: "anna@x.it" },
          { name: "Cc", value: "b@y.it" },
          { name: "Subject", value: "Offerta" },
          { name: "Message-Id", value: "<abc@mail.cliente.it>" },
        ],
        parts: [part("text/plain", "Va bene"), part("text/html", "<p>Va bene</p>")],
      },
    };
    expect(readGmailMessage({ ...base, labelIds: ["INBOX"] })).toEqual({
      providerId: "m1",
      messageId: "abc@mail.cliente.it",
      threadId: "t1",
      from: "mario@cliente.it",
      to: ["anna@x.it"],
      cc: ["b@y.it"],
      subject: "Offerta",
      text: "Va bene",
      date: new Date("2026-09-27T09:00:00Z"),
    });
    expect(readGmailMessage({ ...base, labelIds: ["SENT"] })?.messageId).toBe("abc@mail.cliente.it");
    expect(readGmailMessage({ ...base, labelIds: ["DRAFT"] })).toBeNull();
    expect(readGmailMessage({ ...base, labelIds: ["INBOX", "SPAM"] })).toBeNull();
    expect(readGmailMessage({ ...base, labelIds: ["CATEGORY_FORUMS"] })).toBeNull();
    // HTML only: read as text.
    const htmlOnly = {
      ...base,
      labelIds: ["INBOX"],
      payload: { ...base.payload, parts: [part("text/html", "<p>Sì</p>")] },
    };
    expect(readGmailMessage(htmlOnly)?.text).toBe("Sì");
  });

  it("⚠️ reads a part in the charset it declares, not always as UTF-8", () => {
    const latin1 = btoa(String.fromCharCode(0x50, 0x65, 0x72, 0x63, 0x68, 0xe9))
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const m = readGmailMessage({
      id: "l1",
      labelIds: ["INBOX"],
      internalDate: "0",
      payload: {
        headers: [{ name: "From", value: "a@b.it" }],
        parts: [
          {
            mimeType: "text/plain",
            headers: [{ name: "Content-Type", value: 'text/plain; charset="iso-8859-1"' }],
            body: { data: latin1 },
          },
        ],
      },
    });
    expect(m?.text).toBe("Perché");
  });

  it("⚠️⚠️ reads history from the cursor and stops before a record that does not fit, so none is lost", async () => {
    const msg = (id: string) => ({
      id,
      labelIds: ["INBOX"],
      internalDate: "0",
      payload: { headers: [{ name: "From", value: "a@b.it" }], parts: [part("text/plain", id)] },
    });
    const { fetchImpl, calls } = fakeFetch([
      [
        /history\?/,
        () => ({
          historyId: "900",
          history: [
            { id: "101", messagesAdded: [{ message: { id: "m1", labelIds: ["INBOX"] } }] },
            {
              id: "102",
              messagesAdded: [
                { message: { id: "m2", labelIds: ["SENT"] } },
                { message: { id: "d", labelIds: ["DRAFT"] } },
              ],
            },
            { id: "103", messagesAdded: [{ message: { id: "m3", labelIds: ["INBOX"] } }] },
          ],
        }),
      ],
      [/messages\/m(\d)\?format=full/, (c) => msg(c.url.match(/messages\/(m\d)/)?.[1] ?? "")],
    ]);
    const p = googleProvider(creds, fetchImpl);
    const page = await p.messagesSince("tok", "100", 2);
    expect(page.messages.map((m) => m.providerId)).toEqual(["m1", "m2"]);
    // m3 did not fit: the next read starts after record 102, not at the mailbox's 900.
    expect(page).toMatchObject({ cursor: "102", more: true });
    expect(new URL(calls[0].url).searchParams.get("startHistoryId")).toBe("100");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer tok");

    const all = await p.messagesSince("tok", "100", 10);
    expect(all).toMatchObject({ cursor: "900", more: false });
    expect(all.messages).toHaveLength(3);
  });

  it("⚠️ a cursor Gmail no longer knows says so, rather than failing the mailbox for ever", async () => {
    const { fetchImpl } = fakeFetch([[/history\?/, () => new Response("gone", { status: 404 })]]);
    await expect(googleProvider(creds, fetchImpl).messagesSince("tok", "1", 5)).rejects.toMatchObject({
      cursorExpired: true,
    });
  });

  it("sends the message raw and reads back the Message-ID Gmail gave it", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/POST .*messages\/send/, () => ({ id: "s1", threadId: "t9" })],
      [
        /GET .*messages\/s1\?format=metadata/,
        () => ({ id: "s1", payload: { headers: [{ name: "Message-ID", value: "<gen@mail.gmail.com>" }] } }),
      ],
    ]);
    const sent = await googleProvider(creds, fetchImpl).send("tok", {
      from: "anna@x.it",
      to: ["c@y.it"],
      subject: "Ciao",
      html: "<p>Ciao</p>",
    });
    expect(sent).toEqual({ providerId: "s1", messageId: "gen@mail.gmail.com", threadId: "t9" });
    const raw = base64UrlDecode(JSON.parse(calls[0].body).raw);
    expect(raw).toContain("From: anna@x.it");
    expect(raw).toContain("To: c@y.it");
  });

  it("busy time from free/busy, and an all-day event as dates in the workspace's zone", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [
        /freeBusy/,
        () => ({ calendars: { primary: { busy: [{ start: "2026-09-28T08:00:00Z", end: "2026-09-28T09:00:00Z" }] } } }),
      ],
      [/POST .*\/events$/, () => ({ id: "ev1" })],
    ]);
    const p = googleProvider(creds, fetchImpl);
    expect(await p.busy("tok", new Date("2026-09-28T00:00:00Z"), new Date("2026-09-29T00:00:00Z"))).toEqual([
      { start: new Date("2026-09-28T08:00:00Z"), end: new Date("2026-09-28T09:00:00Z") },
    ]);
    // Midnight to midnight in Rome is 22:00 to 22:00 UTC the day before.
    await p.createEvent("tok", {
      title: "Ferie",
      start: new Date("2026-09-29T22:00:00Z"),
      end: new Date("2026-09-30T22:00:00Z"),
      allDay: true,
      timeZone: "Europe/Rome",
    });
    expect(JSON.parse(calls[1].body)).toMatchObject({
      start: { date: "2026-09-30" },
      end: { date: "2026-10-01" },
      transparency: "transparent",
    });
  });

  it("an event already gone at Google is deleted", async () => {
    const { fetchImpl } = fakeFetch([[/DELETE/, () => new Response("", { status: 410 })]]);
    await expect(googleProvider(creds, fetchImpl).deleteEvent("tok", "ev1")).resolves.toBeUndefined();
    const failing = fakeFetch([[/DELETE/, () => new Response("", { status: 500 })]]);
    await expect(googleProvider(creds, failing.fetchImpl).deleteEvent("tok", "ev1")).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

describe("Microsoft", () => {
  it("asks for offline access with PKCE, and names every scope at the token endpoint too", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/token$/, () => ({ access_token: "at", refresh_token: "rt2", expires_in: 3600 })],
    ]);
    const p = microsoftProvider({ ...creds, tenant: "" }, fetchImpl);
    const url = new URL(p.authorizeUrl({ state: "st", redirectUri: "r", codeChallenge: "ch" }));
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // ⚠️ The refresh token rotates: the new one comes back to be kept.
    expect((await p.refresh("rt1")).refreshToken).toBe("rt2");
    expect(new URLSearchParams(calls[0].body).get("scope")).toContain("Mail.Send");
  });

  it("⚠️ reads the inbox and sent items each from its own instant, and moves each on", async () => {
    const m = (id: string, at: string, extra = {}) => ({
      id,
      internetMessageId: `<${id}@x>`,
      conversationId: "c",
      from: { emailAddress: { address: "Mario@Cliente.it" } },
      toRecipients: [{ emailAddress: { address: "anna@x.it" } }],
      ccRecipients: [],
      subject: "S",
      body: { contentType: "text", content: "corpo" },
      receivedDateTime: at,
      ...extra,
    });
    const { fetchImpl, calls } = fakeFetch([
      [
        /mailFolders\/inbox/,
        () => ({ value: [m("i1", "2026-09-27T09:00:00Z"), m("i2", "2026-09-27T09:05:00Z", { isDraft: true })] }),
      ],
      [/mailFolders\/sentitems/, () => ({ value: [] })],
    ]);
    const p = microsoftProvider(creds, fetchImpl);
    const start = await p.startCursor("tok", new Date("2026-09-27T08:00:00Z"));
    const page = await p.messagesSince("tok", start, 4);
    expect(page.messages.map((x) => [x.messageId, x.from])).toEqual([["i1@x", "mario@cliente.it"]]);
    expect(JSON.parse(page.cursor)).toEqual({ inbox: "2026-09-27T09:05:00Z", sent: "2026-09-27T08:00:00.000Z" });
    expect(page.more).toBe(true);
    expect(decodeURIComponent(calls[0].url)).toContain("receivedDateTime ge 2026-09-27T08:00:00.000Z");
    // OData, not a form: a literal $ and %20, never + for a space.
    expect(calls[0].url).toContain("?$filter=receivedDateTime%20ge%20");
    expect(calls[0].headers.get("Prefer")).toBe('outlook.body-content-type="text"');
    await expect(p.messagesSince("tok", "not json", 4)).rejects.toMatchObject({ cursorExpired: true });
  });

  it("answers inside the original thread when the mailbox still has it", async () => {
    const { fetchImpl, calls } = fakeFetch([
      [/GET .*me\/messages\?\$filter=/, () => ({ value: [{ id: "orig" }] })],
      [/POST .*orig\/createReply/, () => ({ id: "draft1" })],
      [/PATCH .*messages\/draft1/, () => ({ id: "draft1", internetMessageId: "<new@x>", conversationId: "c1" })],
      [/POST .*draft1\/send/, () => new Response(null, { status: 202 })],
    ]);
    const sent = await microsoftProvider(creds, fetchImpl).send("tok", {
      from: "anna@x.it",
      to: ["c@y.it"],
      subject: "Re: Offerta",
      html: "<p>Sì</p>",
      inReplyTo: "abc@mail.y.it",
    });
    expect(sent).toEqual({ providerId: "draft1", messageId: "new@x", threadId: "c1" });
    expect(decodeURIComponent(calls[0].url)).toContain("internetMessageId eq '<abc@mail.y.it>'");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PATCH", "POST"]);
  });

  it("busy is what is not free, read in UTC", async () => {
    const { fetchImpl } = fakeFetch([
      [
        /calendarView/,
        () => ({
          value: [
            {
              start: { dateTime: "2026-09-28T08:00:00.0000000" },
              end: { dateTime: "2026-09-28T09:00:00.0000000" },
              showAs: "busy",
            },
            {
              start: { dateTime: "2026-09-28T10:00:00.0000000" },
              end: { dateTime: "2026-09-28T11:00:00.0000000" },
              showAs: "free",
            },
            {
              start: { dateTime: "2026-09-28T12:00:00.0000000" },
              end: { dateTime: "2026-09-28T13:00:00.0000000" },
              showAs: "busy",
              isCancelled: true,
            },
          ],
        }),
      ],
    ]);
    expect(await microsoftProvider(creds, fetchImpl).busy("tok", new Date(), new Date())).toEqual([
      { start: new Date("2026-09-28T08:00:00Z"), end: new Date("2026-09-28T09:00:00Z") },
    ]);
  });

  it("⚠️⚠️ asks for Mail.ReadWrite: a draft is how a send gets its id, and Mail.Send cannot create one", () => {
    const url = new URL(microsoftProvider(creds).authorizeUrl({ state: "s", redirectUri: "r", codeChallenge: "c" }));
    expect(url.searchParams.get("scope")?.split(" ")).toContain("Mail.ReadWrite");
  });

  it("⚠️ an all-day appointment goes in as free: availability does not count it busy here either", async () => {
    const { fetchImpl, calls } = fakeFetch([[/POST .*\/me\/events/, () => ({ id: "e" })]]);
    await microsoftProvider(creds, fetchImpl).createEvent("tok", {
      title: "Ferie",
      start: new Date("2026-09-29T22:00:00Z"),
      end: new Date("2026-09-30T22:00:00Z"),
      allDay: true,
      timeZone: "Europe/Rome",
    });
    expect(JSON.parse(calls[0].body)).toMatchObject({ isAllDay: true, showAs: "free" });
  });

  it("never files a draft", () => {
    expect(readGraphMessage({ id: "x", isDraft: true, from: { emailAddress: { address: "a@b.it" } } })).toBeNull();
    expect(readGraphMessage({ id: "x" })).toBeNull();
  });
});

/**
 * The little MIME a mailbox connection needs: building one message to send through Gmail,
 * and reading addresses and text out of what comes back. Web APIs only.
 *
 * ⚠️⚠️ Every header value is stripped of CR and LF before it is written. A subject or a
 * name with a line break in it would otherwise add headers of its own — a Bcc nobody typed.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64UrlEncode(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? encoder.encode(text) : text;
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function base64UrlDecode(data: string): string {
  return decoder.decode(base64UrlBytes(data));
}

/** A header value with no way to start another header. */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 for anything outside printable ASCII; plain otherwise. */
export function encodeWord(value: string): string {
  const safe = headerSafe(value);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find them
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${bytesToBase64(encoder.encode(safe))}?=`;
}

function mailbox(address: string, name?: string | null): string {
  const addr = headerSafe(address);
  if (!name) return addr;
  const display = encodeWord(name);
  // A plain name with specials goes in quotes; an encoded word must not.
  return display.startsWith("=?") ? `${display} <${addr}>` : `"${display.replace(/["\\]/g, "")}" <${addr}>`;
}

function angle(id: string): string {
  const bare = headerSafe(id).replace(/^<|>$/g, "");
  return `<${bare}>`;
}

/** One HTML message as RFC 5322 text, ready for Gmail's `raw`. */
export function buildRfc822(mail: {
  from: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  inReplyTo?: string | null;
  date?: Date;
}): string {
  const list = (xs: string[]) => xs.map((x) => headerSafe(x)).join(", ");
  const headers = [
    `From: ${mailbox(mail.from, mail.fromName)}`,
    `To: ${list(mail.to)}`,
    ...(mail.cc?.length ? [`Cc: ${list(mail.cc)}`] : []),
    // Gmail reads Bcc from the raw message and removes it before delivery.
    ...(mail.bcc?.length ? [`Bcc: ${list(mail.bcc)}`] : []),
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${(mail.date ?? new Date()).toUTCString()}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${angle(mail.inReplyTo)}`, `References: ${angle(mail.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const body = (bytesToBase64(encoder.encode(mail.html)).match(/.{1,76}/g) ?? []).join("\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** Every address in a header value, lower-cased: "Anna <a@x.it>, b@y.it" → both. */
export function addressesIn(value: string | null | undefined): string[] {
  if (!value) return [];
  // Quoted display names can hold commas and even "@"; drop them before looking.
  const unquoted = value.replace(/"(?:[^"\\]|\\.)*"/g, "");
  const found = unquoted.match(/[^\s<>,;:()"']+@[^\s<>,;:()"']+\.[^\s<>,;:()"']+/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))];
}

/** Readable text out of HTML: enough to file on a timeline, not a renderer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What is kept of a message body: the text, cut to a size a timeline can carry. */
export const MAX_TEXT = 20_000;

export function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

import { and, eq, inArray, sql } from "drizzle-orm";

import { activities, contacts, leads, mailArchiveAddresses } from "@/db/schema";
import { parseFromHeader, recipientAddresses } from "@/lib/email-parser";

/**
 * The address a person puts in Bcc when they write from Gmail or Outlook, so the email is
 * filed on the records it was sent to (§9 step 2).
 *
 * ⚠️⚠️ Almost all email with a customer is written outside Flux, and none of it reached a
 * timeline: the record said "last contact three weeks ago" about somebody who was emailed
 * yesterday, and the only fix was typing it in twice — the first reason a CRM is abandoned.
 * This is most of what a mailbox connection would give, with no OAuth review and no
 * credentials held for anybody.
 *
 * The address is `crm+<workspace>.<token>@<INBOUND_BCC_DOMAIN>`:
 *
 * - the workspace's subdomain names the tenant, so an email is routed without asking
 *   every workspace whether the token is theirs;
 * - the token names the person, and **is the credential** — anybody who knows the address
 *   can file email in that person's name, exactly as with any CRM's Bcc address. It is
 *   random, per person, and rotating it retires the old address at once: the lookup is not
 *   cached.
 *
 * ⚠️ `INBOUND_BCC_DOMAIN` is a domain whose MX delivers to the inbound webhook (Resend
 * receiving, or any bridge). Unset, the feature is absent and the profile page says so —
 * an address that reaches nowhere would look like it works and archive nothing.
 *
 * ⚠️ A Bcc address appears in no header anybody else sees, so it is found among the
 * envelope recipients (`Delivered-To`, the bridge's `recipient`), which is why the routes
 * pass them separately.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

const TOKEN_LENGTH = 20;
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
/** `crm+<subdomain>.<token>`: a subdomain as the registry allows one, then exactly one token. */
const ARCHIVE_LOCAL_PART = /^crm\+([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.([a-z2-7]{20})$/;

/**
 * Records one email is filed on, at most. A message to a mailing list is not a
 * conversation with each of its members, and the insert is one statement either way.
 */
export const ARCHIVE_MAX_RECORDS = 25;

export function archiveDomain(env: Record<string, string | undefined> = process.env): string | null {
  const domain = env.INBOUND_BCC_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/** 100 random bits in lowercase base32: survives any mail system's case folding. */
export function newArchiveToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b & 31]).join("");
}

export function archiveAddress(subdomain: string, token: string, domain: string): string {
  return `crm+${subdomain}.${token}@${domain}`;
}

/** The workspace and the token, when `address` is an archive address on `domain`. */
export function parseArchiveAddress(address: string, domain: string): { subdomain: string; token: string } | null {
  const clean = address.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 0 || clean.slice(at + 1) !== domain) return null;
  const match = ARCHIVE_LOCAL_PART.exec(clean.slice(0, at));
  return match ? { subdomain: match[1], token: match[2] } : null;
}

/** The first archive address among everything the message was delivered to. */
export function findArchiveAlias(
  headers: string[],
  domain: string | null,
): { subdomain: string; token: string; address: string } | null {
  if (!domain) return null;
  for (const header of headers) {
    for (const address of recipientAddresses(header)) {
      const parsed = parseArchiveAddress(address, domain);
      if (parsed) return { ...parsed, address };
    }
  }
  return null;
}

/** This person's token, created the first time it is asked for. */
export async function ensureArchiveToken(db: AnyDb, userId: string): Promise<string> {
  await db.insert(mailArchiveAddresses).values({ userId, token: newArchiveToken() }).onConflictDoNothing();
  const [row] = await db
    .select({ token: mailArchiveAddresses.token })
    .from(mailArchiveAddresses)
    .where(eq(mailArchiveAddresses.userId, userId));
  return row.token;
}

/** A new address for this person; the old one stops filing anything from now. */
export async function rotateArchiveToken(db: AnyDb, userId: string): Promise<string> {
  const token = newArchiveToken();
  await db
    .insert(mailArchiveAddresses)
    .values({ userId, token })
    .onConflictDoUpdate({ target: mailArchiveAddresses.userId, set: { token, createdAt: new Date() } });
  return token;
}

export async function archiveOwner(db: AnyDb, token: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: mailArchiveAddresses.userId })
    .from(mailArchiveAddresses)
    .where(eq(mailArchiveAddresses.token, token));
  return row?.userId ?? null;
}

export interface ArchivedEmail {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  messageId: string | null;
}

interface Match {
  email: string;
  contactId: string | null;
  leadId: string | null;
  companyId: string | null;
}

/**
 * Files the email on every contact and open lead among its sender and recipients.
 *
 * Direction is read per record: the record that *sent* it wrote to us, every other one was
 * written to. That needs no list of the workspace's own addresses, which a person writing
 * from a personal mailbox would not be on anyway.
 *
 * ⚠️ A contact wins over a lead with the same address, as everywhere else: it is what the
 * lead became. A lead already converted is not a place anybody looks.
 *
 * ⚠️ Filed at most once per message and record: a webhook delivered twice, or one email
 * copied to the address by two colleagues, is one entry (the unique index on
 * `message_id`, taken by the insert itself rather than read first).
 */
export async function fileArchivedEmail(
  db: AnyDb,
  ownerId: string,
  email: ArchivedEmail,
  archiveDomainName: string,
  now = new Date(),
): Promise<{ filed: number; matched: number }> {
  const sender = parseFromHeader(email.from).email?.toLowerCase() ?? null;
  const participants = [
    ...new Set(
      [sender, ...recipientAddresses(email.to), ...recipientAddresses(email.cc ?? "")].filter(
        (a): a is string => !!a && !a.endsWith(`@${archiveDomainName}`),
      ),
    ),
  ];
  if (participants.length === 0) return { filed: 0, matched: 0 };

  const contactRows: { id: string; email: string; companyId: string | null }[] = await db
    .select({ id: contacts.id, email: sql<string>`lower(${contacts.email})`, companyId: contacts.companyId })
    .from(contacts)
    .where(inArray(sql`lower(${contacts.email})`, participants));
  const byContact = new Set(contactRows.map((c) => c.email));
  const rest = participants.filter((p) => !byContact.has(p));
  const leadRows: { id: string; email: string }[] =
    rest.length === 0
      ? []
      : await db
          .select({ id: leads.id, email: sql<string>`lower(${leads.email})` })
          .from(leads)
          .where(and(inArray(sql`lower(${leads.email})`, rest), eq(leads.isConverted, false)));

  const matches: Match[] = [
    ...contactRows.map((c) => ({ email: c.email, contactId: c.id, leadId: null, companyId: c.companyId })),
    ...leadRows.map((l) => ({ email: l.email, contactId: null, leadId: l.id, companyId: null })),
  ].slice(0, ARCHIVE_MAX_RECORDS);
  if (matches.length === 0) return { filed: 0, matched: 0 };

  const text = email.text.trim();
  const inserted: { id: string }[] = await db
    .insert(activities)
    .values(
      matches.map((m) => {
        const incoming = m.email === sender;
        return {
          type: "email",
          content: JSON.stringify({
            _type: "email_v2",
            direction: incoming ? "in" : "out",
            from: email.from,
            to: [email.to, email.cc].filter(Boolean).join(", "),
            subject: email.subject,
            snippet: text.substring(0, 300),
            bodyText: text.substring(0, 5000),
          }),
          date: now,
          // Written by the customer when they sent it; by the person archiving it otherwise.
          ownerId: incoming ? null : ownerId,
          contactId: m.contactId,
          leadId: m.leadId,
          companyId: m.companyId,
          messageId: email.messageId,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: activities.id });
  return { filed: inserted.length, matched: matches.length };
}

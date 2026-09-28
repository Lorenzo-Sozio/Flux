import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { deals, notificationPreferences, quotes, tasks, users } from "@/db/schema";
import { nextStepByDeal } from "@/lib/deal-signals";
import { REPLY_TASK_PREFIX } from "@/lib/inbound-sales-reply";
import { toWallDate } from "@/lib/wall-clock";
import { dayBounds } from "@/lib/workspace-day";

/**
 * One morning email per person, in place of one email per task.
 *
 * ⚠️⚠️ The reminder job sent an email for every task due today — no summary, no way to turn
 * it off — so a busy day was a dozen identical emails, and the sensible response was a mail
 * filter that also caught everything else Flux sent. The digest says, once: what is due
 * today, what is late, which deals have nothing planned, who is waiting for an answer, which
 * accepted quotes are not orders yet. The bell and the push for each task stay.
 *
 * ⚠️ A handful of grouped queries per workspace, never the full work list per person: the
 * job runs every workspace in one request, and a Worker's subrequest budget is a thousand.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export type DigestLocale = "it" | "en";

export interface DigestData {
  dueToday: string[];
  overdue: number;
  dealsWithoutStep: number;
  repliesDue: number;
  quotesToOrder: number;
}

export function isEmptyDigest(d: DigestData): boolean {
  return d.dueToday.length + d.overdue + d.dealsWithoutStep + d.repliesDue + d.quotesToOrder === 0;
}

const empty = (): DigestData => ({ dueToday: [], overdue: 0, dealsWithoutStep: 0, repliesDue: 0, quotesToOrder: 0 });

/** What each of `people` has waiting this morning, in the workspace's day. */
export async function collectDigests(
  db: AnyDb,
  people: string[],
  timeZone: string,
  now: Date = new Date(),
): Promise<Map<string, DigestData>> {
  const out = new Map<string, DigestData>(people.map((id) => [id, empty()]));
  if (people.length === 0) return out;
  const { start, end } = dayBounds(now, timeZone);
  const of = (id: string | null) => (id ? out.get(id) : undefined);

  // Open tasks due by the end of today: today's by title, earlier ones counted, replies owed.
  const open = await db
    .select({
      title: tasks.title,
      type: tasks.type,
      dueDate: tasks.dueDate,
      person: sql<string | null>`coalesce(${tasks.assigneeId}, ${tasks.ownerId})`,
    })
    .from(tasks)
    .where(
      and(
        ne(tasks.status, "done"),
        inArray(sql`coalesce(${tasks.assigneeId}, ${tasks.ownerId})`, people),
        sql`(${tasks.dueDate} < ${end} or (${tasks.type} = 'email' and ${tasks.title} like ${`${REPLY_TASK_PREFIX}%`}))`,
      ),
    );
  for (const t of open) {
    const d = of(t.person);
    if (!d) continue;
    if (t.type === "email" && t.title.startsWith(REPLY_TASK_PREFIX)) d.repliesDue++;
    else if (t.dueDate && new Date(t.dueDate) < start) d.overdue++;
    else if (t.dueDate) d.dueToday.push(t.title);
  }

  // Open deals with nothing planned, per owner.
  const next = nextStepByDeal(db, now);
  const bare = await db
    .select({ owner: deals.ownerId, n: sql<number>`count(*)::int` })
    .from(deals)
    .leftJoin(next, eq(next.dealId, deals.id))
    .where(and(eq(deals.status, "open"), inArray(deals.ownerId, people), sql`${next.n} is null`))
    .groupBy(deals.ownerId);
  for (const r of bare) {
    const d = of(r.owner);
    if (d) d.dealsWithoutStep = Number(r.n);
  }

  // Accepted quotes not yet orders, per owner.
  const accepted = await db
    .select({ owner: quotes.ownerId, n: sql<number>`count(*)::int` })
    .from(quotes)
    .where(and(eq(quotes.status, "accepted"), inArray(quotes.ownerId, people)))
    .groupBy(quotes.ownerId);
  for (const r of accepted) {
    const d = of(r.owner);
    if (d) d.quotesToOrder = Number(r.n);
  }
  return out;
}

// ─── The email ────────────────────────────────────────────────────────────────

const TEXT = {
  it: {
    subject: "Buongiorno: {n} cose per oggi",
    greeting: "Buongiorno {name},",
    intro: "ecco cosa ti aspetta oggi.",
    dueToday: "Da fare oggi",
    overdue: "Attività scadute",
    dealsWithoutStep: "Trattative senza un prossimo passo",
    repliesDue: "Clienti che aspettano una tua risposta",
    quotesToOrder: "Preventivi accettati da trasformare in ordine",
    more: "e altre {n}",
    open: "Apri Flux",
    footer: "Ricevi questo riepilogo ogni mattina. Puoi disattivarlo in Le mie notifiche.",
  },
  en: {
    subject: "Good morning: {n} things for today",
    greeting: "Good morning {name},",
    intro: "here is what is waiting for you today.",
    dueToday: "Due today",
    overdue: "Overdue tasks",
    dealsWithoutStep: "Deals with no next step",
    repliesDue: "Customers waiting for your answer",
    quotesToOrder: "Accepted quotes to turn into orders",
    more: "and {n} more",
    open: "Open Flux",
    footer: "You receive this summary every morning. You can turn it off in My notifications.",
  },
} as const;

export const DIGEST_TEXT = TEXT;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/** The digest as an email, or null when there is nothing to say. */
export function digestEmail(
  d: DigestData,
  opts: { name: string | null; locale: DigestLocale; appUrl: string },
): { subject: string; html: string } | null {
  if (isEmptyDigest(d)) return null;
  const tx = TEXT[opts.locale];
  const total = d.dueToday.length + d.overdue + d.dealsWithoutStep + d.repliesDue + d.quotesToOrder;
  const line = (label: string, n: number) =>
    n > 0 ? `<li style="margin:4px 0"><strong>${n}</strong> · ${esc(label)}</li>` : "";
  const shown = d.dueToday.slice(0, 5);
  const today =
    d.dueToday.length > 0
      ? `<p style="margin:16px 0 4px;font-weight:600">${esc(tx.dueToday)}</p><ul style="margin:0;padding-left:18px">${shown
          .map((title) => `<li style="margin:2px 0">${esc(title)}</li>`)
          .join("")}${
          d.dueToday.length > shown.length
            ? `<li style="margin:2px 0;color:#6b7280">${esc(fill(tx.more, { n: d.dueToday.length - shown.length }))}</li>`
            : ""
        }</ul>`
      : "";
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111827">
      <p>${esc(fill(tx.greeting, { name: opts.name ?? "" }).replace(" ,", ","))}</p>
      <p>${esc(tx.intro)}</p>
      <ul style="margin:0;padding-left:18px">
        ${line(tx.repliesDue, d.repliesDue)}
        ${line(tx.overdue, d.overdue)}
        ${line(tx.quotesToOrder, d.quotesToOrder)}
        ${line(tx.dealsWithoutStep, d.dealsWithoutStep)}
      </ul>
      ${today}
      <p style="margin-top:20px">
        <a href="${opts.appUrl}/dashboard/crm" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">${esc(tx.open)}</a>
      </p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px">${esc(tx.footer)}</p>
    </div>`;
  return { subject: fill(tx.subject, { n: total }), html };
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/**
 * Sends the day's digest to every member who wants one and has something waiting —
 * once per day, whatever the job's schedule does: `digest_sent_on` is claimed with a
 * conditional update before the email goes.
 */
export async function sendMorningDigests(
  db: AnyDb,
  opts: {
    members: string[];
    timeZone: string;
    appUrl: string;
    send: (to: string, subject: string, html: string) => Promise<unknown>;
    now?: Date;
  },
): Promise<number> {
  const now = opts.now ?? new Date();
  const day = toWallDate(now, opts.timeZone);
  if (opts.members.length === 0) return 0;

  const people = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      wants: notificationPreferences.digestEmail,
      locale: notificationPreferences.locale,
      sentOn: notificationPreferences.digestSentOn,
    })
    .from(users)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(and(inArray(users.id, opts.members), isNotNull(users.email)));
  const eligible = people.filter(
    (p: { wants: boolean | null; sentOn: string | null }) => p.wants !== false && p.sentOn !== day,
  );
  if (eligible.length === 0) return 0;

  const digests = await collectDigests(
    db,
    eligible.map((p: { id: string }) => p.id),
    opts.timeZone,
    now,
  );
  let sent = 0;
  for (const p of eligible) {
    const mail = digestEmail(digests.get(p.id) ?? empty(), {
      name: p.name,
      locale: p.locale === "en" ? "en" : "it",
      appUrl: opts.appUrl,
    });
    if (!mail) continue;
    // ⚠️ Claimed before sending, by the update itself: of two runs on the same morning only
    // one sees its row change, and only that one sends.
    await db.insert(notificationPreferences).values({ userId: p.id }).onConflictDoNothing();
    const claimed = await db
      .update(notificationPreferences)
      .set({ digestSentOn: day })
      .where(
        and(
          eq(notificationPreferences.userId, p.id),
          sql`${notificationPreferences.digestSentOn} is distinct from ${day}`,
        ),
      )
      .returning({ userId: notificationPreferences.userId });
    if (claimed.length === 0) continue;
    try {
      await opts.send(p.email, mail.subject, mail.html);
      sent++;
    } catch (err) {
      console.error(`[morning-digest] not delivered to ${p.id}:`, err);
    }
  }
  return sent;
}

/**
 * Remembers the language this person uses the product in, so an email sent at six in the
 * morning — with no request to read it from — is written in it. One statement, and it
 * writes only when the language changed.
 */
export async function rememberLocale(db: AnyDb, userId: string, locale: string): Promise<void> {
  if (locale !== "it" && locale !== "en") return;
  await db
    .insert(notificationPreferences)
    .values({ userId, locale })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { locale },
      setWhere: sql`${notificationPreferences.locale} is distinct from ${locale}`,
    });
}

/**
 * The language a person reads the product in, as last remembered — for what is written to
 * them with no request to learn it from: a push, a reminder email. Null when never seen.
 */
export async function readLocale(db: AnyDb, userId: string): Promise<"it" | "en" | null> {
  const [row] = await db
    .select({ locale: notificationPreferences.locale })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return row?.locale === "it" || row?.locale === "en" ? row.locale : null;
}

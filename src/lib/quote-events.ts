import { eq } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { contacts, type quotes } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

/**
 * Tell the integrations that a quote has left, with an address they can hand to the person.
 *
 * ⚠️⚠️ No fallback base URL, on purpose. A localhost default here would not fail: it would
 * send a real customer a link to a machine that is not theirs, which is a successful
 * delivery to the wrong place — the shape nobody goes looking for. Without the base the
 * event still goes out, carrying everything except the address, and the receiver says so
 * on its own side.
 *
 * ⚠️ The contact's phone and email travel because that is the only thing both systems have
 * in common: our id for this person means nothing on the other side.
 */
export async function announceQuoteSent(quote: typeof quotes.$inferSelect, actor: string) {
  const db = await getDb();
  const contact = quote.contactId
    ? await db.query.contacts.findFirst({ where: eq(contacts.id, quote.contactId) })
    : null;

  const base = process.env.NEXTAUTH_URL;
  if (!base) {
    console.warn("[quotes] NEXTAUTH_URL is unset: the quote event carries no address");
  }
  const url =
    base && quote.publicToken
      ? `${base.replace(/\/$/, "")}/api/quotes/${quote.id}/pdf?token=${quote.publicToken}`
      : undefined;

  await dispatchWebhook(
    "quote.sent",
    {
      quote: { id: quote.id, number: quote.quoteNumber, version: quote.version },
      email: contact?.email ?? undefined,
      phone: contact?.phone ?? undefined,
      url,
      // ⚠️ What the recipient sees instead of a preview. Without it an attachment arrives
      // nameless, which looks a lot like something not to open.
      nome: `Preventivo ${quote.quoteNumber}.pdf`,
    },
    // A person pressed send. Marking this `api` would make an integration that filters its
    // own writes ignore the one event it is waiting for.
    { via: "user", actor },
  ).catch((e) => console.error("[quotes] quote.sent not dispatched", e));
}

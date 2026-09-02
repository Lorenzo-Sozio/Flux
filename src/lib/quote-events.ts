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
async function reachOf(quote: typeof quotes.$inferSelect) {
  const db = await getDb();
  const contact = quote.contactId
    ? await db.query.contacts.findFirst({ where: eq(contacts.id, quote.contactId) })
    : null;
  // ⚠️ The contact's phone and email travel because that is the only thing both systems
  // have in common: our id for this person means nothing on the other side.
  return { email: contact?.email ?? undefined, phone: contact?.phone ?? undefined };
}

/**
 * Statuses a quote can only be in once it has already left.
 *
 * ⚠️⚠️ Announcing on `status === "sent"` alone announces a **save**, not a departure.
 * Editing a note on a quote that was already sent posts the same status back, and the
 * assistant on the other side would hand the customer the same PDF a second time. Nothing
 * fails: the request succeeds, the log looks normal, and the customer gets it twice.
 *
 * It lives here and not next to the caller because it is part of what the event means.
 */
const ALREADY_OUT = new Set(["sent", "viewed", "accepted", "declined", "converted"]);

export function hasAlreadyLeft(status: string): boolean {
  return ALREADY_OUT.has(status);
}

/**
 * The customer answered: yes or no.
 *
 * ⚠️⚠️ This is the piece an assistant cannot find out on its own, and without it it keeps
 * asking «did you see the quote?» to someone who has already accepted. Nothing fails when
 * it is missing, which is why it went unnoticed until now.
 *
 * ⚠️ Both answers are announced, not just the good one. A receiver that only hears about
 * acceptances has to treat silence as a refusal, and silence also means a delivery that
 * never arrived.
 *
 * ⚠️ `via: "user"` even when the customer clicked it from the public page with no account:
 * that field exists so an integration can drop the events it caused itself, and this one
 * it certainly did not. Marking it `api` would make it discard the answer it is waiting
 * for. The actor is null because the person who clicked has no user id here.
 */
export async function announceQuoteDecision(
  quote: typeof quotes.$inferSelect,
  decision: "accepted" | "declined",
  actor: string | null,
) {
  await dispatchWebhook(
    decision === "accepted" ? "quote.accepted" : "quote.declined",
    {
      quote: { id: quote.id, number: quote.quoteNumber, version: quote.version },
      ...(await reachOf(quote)),
    },
    { via: "user", actor },
  ).catch((e) => console.error(`[quotes] quote.${decision} not dispatched`, e));
}

export async function announceQuoteSent(quote: typeof quotes.$inferSelect, actor: string) {
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
      ...(await reachOf(quote)),
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

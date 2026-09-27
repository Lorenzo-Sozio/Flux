/**
 * `consent.withdrawn`: somebody said stop, and every integration that writes to them hears it.
 *
 * ⚠️⚠️ **Opt-out has to travel both ways.** The assistant (VoipAI) pushes its opt-outs into
 * Flux through `/api/crm/opt-out`; before this event, an unsubscribe clicked in a Flux email
 * never reached it, and it kept writing on WhatsApp to somebody who had asked Flux to stop.
 *
 * ⚠️ **The act, not the flag.** From the unsubscribe link and the opt-out API the event is
 * sent whenever a person asks — even if the record's consent was already false: consent in
 * Flux is one thing, and the other system's own consent for the same person is another it
 * must now withdraw. From the record page it is sent when the consent goes from yes to no.
 *
 * The contact point is at the top of the payload (`email`, `phone`, `mobile`), where a
 * receiver that matches people by address looks for it. `channel` says what was refused:
 * - `email` — an email's unsubscribe link: no more emails of that kind;
 * - `marketing` — the marketing consent unticked on the record: no more promotion, anywhere,
 *   while the follow-ups the person asked for (a quote, a booking) go on. Two purposes, not
 *   one (decided 27 September 2026) — the same line `/api/crm/opt-out` draws;
 * - `all` — the person asked not to be contacted at all (`/api/crm/opt-out`).
 */
import { eq, inArray } from "drizzle-orm";

import { contacts, leads } from "@/db/schema";
import type { ConsentSource } from "@/lib/consent";
import { dispatchWebhook, type WebhookDispatchDb } from "@/lib/webhook-dispatch";
import type { Origin } from "@/lib/webhook-envelope";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface OptOut {
  /** The records of that person, when there are any: an address alone is still an opt-out. */
  records: { entity: "lead" | "contact"; id: string }[];
  /** The address the person used, when the act came with one (the unsubscribe link). */
  email?: string | null;
  source: ConsentSource;
  channel: "email" | "marketing" | "all";
}

export async function announceOptOut(db: AnyDb, optOut: OptOut, origin: Origin): Promise<void> {
  const leadIds = optOut.records.filter((r) => r.entity === "lead").map((r) => r.id);
  const contactIds = optOut.records.filter((r) => r.entity === "contact").map((r) => r.id);
  const [leadRows, contactRows] = await Promise.all([
    leadIds.length
      ? db
          .select({ email: leads.email, phone: leads.phone, mobile: leads.mobile })
          .from(leads)
          .where(leadIds.length === 1 ? eq(leads.id, leadIds[0]) : inArray(leads.id, leadIds))
      : [],
    contactIds.length
      ? db
          .select({ email: contacts.email, phone: contacts.phone, mobile: contacts.mobile })
          .from(contacts)
          .where(contactIds.length === 1 ? eq(contacts.id, contactIds[0]) : inArray(contacts.id, contactIds))
      : [],
  ]);
  const rows: { email: string | null; phone: string | null; mobile: string | null }[] = [...leadRows, ...contactRows];
  const first = (pick: (r: (typeof rows)[number]) => string | null) => rows.map(pick).find(Boolean) ?? null;
  const email = optOut.email?.trim().toLowerCase() || first((r) => r.email);
  const phone = first((r) => r.phone);
  const mobile = first((r) => r.mobile);
  if (!email && !phone && !mobile) return;

  await dispatchWebhook(
    "consent.withdrawn",
    {
      email,
      phone,
      mobile,
      channel: optOut.channel,
      source: optOut.source,
      records: optOut.records,
    },
    origin,
    db as WebhookDispatchDb,
  ).catch((err) => console.error("[consent] consent.withdrawn not dispatched", err));
}

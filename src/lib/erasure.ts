/**
 * Erasing a person, starting from a contact point (GDPR art. 17).
 *
 * A person is not a row here: they are a `lead`, or a `contact`, or both, plus every trail
 * that names them. So erasure starts from the only thing the person themselves can give —
 * an email address or a phone number — and never from an internal id.
 *
 * ## ⚠️⚠️ Order matters, and getting it wrong is worse than doing nothing
 *
 * Anonymising the contact **destroys the index**: once their email is gone from `contact`,
 * nothing else can be found from the contact point any more. So this module finds the
 * person first, scrubs every trail, and anonymises the contact **last**. An earlier version
 * did it the other way round and left the trails unreachable — the data kept, the ability
 * to finish the job lost. A repeat request could not have been honoured.
 *
 * ## What the schema already decided, and it is not an opinion
 *
 * Foreign keys from `activity`, `task` and `campaign_log` **cascade**: deleting a *lead*
 * takes their words with them. Foreign keys from `deal`, `quote`, `order`, `opportunity`,
 * `ticket` and `appointment` **do not**: a straight `DELETE` of a *contact* with commercial
 * history fails with a foreign key violation — measured, not assumed.
 *
 * So a contact is **anonymised**, not deleted: the business keeps its accounts, the person
 * disappears from them. Deleting the commercial records instead would destroy the
 * business's own books, and where invoicing rules require retention it would not even be
 * lawful. But anonymising the contact alone is not enough, because the cascades never fire:
 * every trail that pointed at them survives with their name inside it. Hence the plan below.
 *
 * ## The criterion
 *
 * Not «I removed the name from the card». **«From here, nobody can get back to them.»**
 */
import { inArray, sql } from "drizzle-orm";

import {
  activities,
  appointmentAttendees,
  campaignLogs,
  contacts,
  emailJobs,
  leads,
  quoteActivities,
  tasks,
  ticketMessages,
  tickets,
} from "@/db/schema";
import { findByContactPoint, matchesContactPoint, readContactPoint } from "@/lib/contact-point";

export interface ErasureReport {
  /** Rows removed outright, by table. */
  deleted: Record<string, number>;
  /** Rows kept, with the person removed from them. */
  anonymised: Record<string, number>;
  /** Rows deliberately untouched, and why. Whoever answers the person reads this. */
  kept: Record<string, string>;
}

/** What replaces a name once the person behind it must no longer be identifiable. */
export const ANONIMO = "[cancellato]";

/**
 * The fields of a person, as opposed to the fields of a business relationship.
 *
 * ⚠️ `firstName` and `lastName` are NOT NULL, so they are overwritten rather than emptied.
 * Everything else becomes null: a blank string is still a value someone can filter on, and
 * reads in the interface as «we know this and it is empty».
 */
const CAMPI_DELLA_PERSONA = {
  firstName: ANONIMO,
  lastName: "",
  email: null,
  phone: null,
  mobile: null,
  linkedinUrl: null,
  street: null,
  city: null,
  zipCode: null,
  notes: null,
  tags: null,
} as const;

/**
 * What is left alone, and why. Each line is an answer someone may have to give.
 *
 * ⚠️ These are **not** oversights: they are the places where erasing more would be the
 * harm, or where a machine should not decide.
 */
const CONSERVATI: Record<string, string> = {
  email_suppression:
    "kept on purpose: it is the record that stops this address being written to again. " +
    "Erasing it would let the next campaign reach the person who asked to be forgotten. " +
    "This retention should be stated in the privacy notice.",
  "deal_comment, dm_message, notification":
    "internal discussion written by the team, which may mention the person. Not rewritten " +
    "automatically: an algorithm editing a conversation either destroys its meaning or " +
    "leaves the name in. They are listed here so a person can decide case by case.",
  "deal, quote, order, opportunity":
    "the business's own commercial records. They survive without the person: the contact " +
    "they point at no longer identifies anybody.",
};

/**
 * Erase the person reachable at this contact point.
 *
 * Idempotent: running it twice is lawful and the second run finds nothing. A person has no
 * way of knowing whether the first request went through, so repeating it is normal.
 */
export async function eraseByContactPoint(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  contactPoint: string,
): Promise<ErasureReport> {
  const { email, digits } = readContactPoint(contactPoint);
  const person = await findByContactPoint(db, email, digits);
  const report: ErasureReport = { deleted: {}, anonymised: {}, kept: { ...CONSERVATI } };

  // biome-ignore lint/suspicious/noExplicitAny: drizzle query builders are not one type
  const quanti = (righe: any) => (Array.isArray(righe) ? righe.length : 0);

  // ── 1. Il lead se ne va per intero: activity, task e campaign_log cascano dietro.
  report.deleted.lead = quanti(
    await db
      .delete(leads)
      .where(matchesContactPoint(leads, email, digits))
      .returning({ id: leads.id }),
  );

  const { contactIds } = person;
  if (contactIds.length > 0) {
    // ── 2. Il diario di quella persona. È il diario *di lei*: senza di lei non significa
    // niente, e riscrivere un testo libero lascia sempre qualcosa dentro.
    report.deleted.activity = quanti(
      await db.delete(activities).where(inArray(activities.contactId, contactIds)).returning({ id: activities.id }),
    );
    report.deleted.task = quanti(
      await db.delete(tasks).where(inArray(tasks.contactId, contactIds)).returning({ id: tasks.id }),
    );
    // ── 3. La coda di invio: ha già fatto il suo lavoro, e il corpo contiene l'indirizzo.
    // `email_job` casca dietro `campaign_log`.
    report.deleted.campaign_log = quanti(
      await db
        .delete(campaignLogs)
        .where(inArray(campaignLogs.contactId, contactIds))
        .returning({ id: campaignLogs.id }),
    );
    // ── 4. L'appuntamento è avvenuto: è un fatto dell'azienda. Chi c'era, non più.
    report.anonymised.appointment_attendee = quanti(
      await db
        .update(appointmentAttendees)
        .set({ email: null, name: ANONIMO })
        .where(inArray(appointmentAttendees.contactId, contactIds))
        .returning({ id: appointmentAttendees.id }),
    );
    // ── 5. Il ticket resta come caso; le parole della persona no.
    report.anonymised.ticket = quanti(
      await db
        .update(tickets)
        .set({ subject: ANONIMO, description: null })
        .where(inArray(tickets.contactId, contactIds))
        .returning({ id: tickets.id }),
    );
  } else {
    report.deleted.activity = 0;
    report.deleted.task = 0;
    report.deleted.campaign_log = 0;
    report.anonymised.appointment_attendee = 0;
    report.anonymised.ticket = 0;
  }

  // ── 6. Le tabelle **senza chiave esterna verso il contatto** si raggiungono dal
  // recapito: è la stessa regola per cui l'art. 17 parte dal recapito.
  if (email) {
    report.anonymised.ticket_message = quanti(
      await db
        .update(ticketMessages)
        .set({ senderEmail: null, senderName: ANONIMO, content: "" })
        .where(sql`lower(btrim(${ticketMessages.senderEmail})) = ${email}`)
        .returning({ id: ticketMessages.id }),
    );
    // L'indirizzo IP è dato personale. Questa tabella serve a sapere *se* un preventivo è
    // stato aperto: il fatto si tiene anche senza chi.
    report.deleted.quote_activity = quanti(
      await db
        .delete(quoteActivities)
        .where(sql`lower(btrim(${quoteActivities.email})) = ${email}`)
        .returning({ id: quoteActivities.id }),
    );
    // Messaggi in coda non legati a una campagna cancellata sopra.
    report.deleted.email_job = quanti(
      await db
        .delete(emailJobs)
        .where(sql`lower(btrim(${emailJobs.toEmail})) = ${email}`)
        .returning({ id: emailJobs.id }),
    );
  } else {
    report.anonymised.ticket_message = 0;
    report.deleted.quote_activity = 0;
    report.deleted.email_job = 0;
  }

  // ── 7. ⚠️⚠️ **Ultimo, e non è un dettaglio d'ordine.** Da qui in poi il recapito non
  // esiste più, e niente di quanto sopra sarebbe più raggiungibile.
  if (contactIds.length > 0) {
    report.anonymised.contact = quanti(
      await db
        .update(contacts)
        .set({ ...CAMPI_DELLA_PERSONA, updatedAt: new Date() })
        .where(inArray(contacts.id, contactIds))
        .returning({ id: contacts.id }),
    );
  } else {
    report.anonymised.contact = 0;
  }

  return report;
}

/**
 * How many rows are still reachable from this contact point. Zero after an erasure.
 *
 * ⚠️ It uses the **same predicates** as the erasure: a preview built from different
 * conditions can describe an operation that will not happen.
 */
export async function countByContactPoint(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  contactPoint: string,
): Promise<{ lead: number; contact: number }> {
  const { email, digits } = readContactPoint(contactPoint);
  const person = await findByContactPoint(db, email, digits);
  return { lead: person.leadIds.length, contact: person.contactIds.length };
}

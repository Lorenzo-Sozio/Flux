/**
 * What the customer reads about their own request: the email sent when it is resolved,
 * the line under every reply, and the status page. In the customer's language
 * (src/lib/document-language.ts), never the agent's — the same rule as a quote.
 *
 * Here and not in messages/*.json because an email has no next-intl, and the page must
 * speak the language the email did. `ticket-public-text.test.ts` checks both languages
 * carry every key.
 */
import type { DocumentLanguage } from "@/lib/document-language";

export const TICKET_TEXT = {
  it: {
    resolvedHeading: "La tua richiesta è stata risolta",
    resolvedBody: "Abbiamo segnato come risolta la richiesta {number}, «{subject}».",
    reopenHint: "Se qualcosa non va ancora, rispondi a questa email: la richiesta si riapre.",
    ratePrompt: "Com'è andata?",
    rateGood: "Bene, grazie",
    rateBad: "Non bene",
    followLink: "Segui la richiesta online",
    replyFooter: "Segui questa richiesta online: {link}",
    pageTitle: "Richiesta {number}",
    opened: "Aperta il {date}",
    updated: "Ultimo aggiornamento: {date}",
    conversation: "Conversazione",
    you: "Tu",
    yourRequest: "La tua richiesta",
    replyHint: "Per aggiungere qualcosa, rispondi a una delle email su questa richiesta.",
    rateHeading: "Com'è andata?",
    rateHelp: "Una risposta con un clic: ci aiuta a capire cosa migliorare.",
    confirmHint: "Premi la risposta evidenziata per confermarla.",
    commentLabel: "Vuoi aggiungere qualcosa? (facoltativo)",
    send: "Invia",
    thanks: "Grazie per la risposta.",
    answered: "Hai risposto: {rating}",
    changeHint: "Puoi cambiare la risposta quando vuoi.",
    failed: "Non è andato a buon fine. Riprova.",
    status: {
      new: "Ricevuta",
      open: "In lavorazione",
      in_progress: "In lavorazione",
      waiting: "In attesa di una tua risposta",
      on_hold: "In sospeso",
      resolved: "Risolta",
      closed: "Chiusa",
    },
  },
  en: {
    resolvedHeading: "Your request has been resolved",
    resolvedBody: "We have marked request {number}, “{subject}”, as resolved.",
    reopenHint: "If something is still not right, reply to this email and the request reopens.",
    ratePrompt: "How did we do?",
    rateGood: "Good, thanks",
    rateBad: "Not good",
    followLink: "Follow the request online",
    replyFooter: "Follow this request online: {link}",
    pageTitle: "Request {number}",
    opened: "Opened on {date}",
    updated: "Last update: {date}",
    conversation: "Conversation",
    you: "You",
    yourRequest: "Your request",
    replyHint: "To add something, reply to any of the emails about this request.",
    rateHeading: "How did we do?",
    rateHelp: "One click: it tells us what to improve.",
    confirmHint: "Press the highlighted answer to confirm it.",
    commentLabel: "Anything to add? (optional)",
    send: "Send",
    thanks: "Thank you for your answer.",
    answered: "You answered: {rating}",
    changeHint: "You can change your answer at any time.",
    failed: "That did not work. Please try again.",
    status: {
      new: "Received",
      open: "In progress",
      in_progress: "In progress",
      waiting: "Waiting for your reply",
      on_hold: "On hold",
      resolved: "Resolved",
      closed: "Closed",
    },
  },
} as const;

export type TicketText = (typeof TICKET_TEXT)[DocumentLanguage];

/** The customer's word for a status; an unknown one reads as "in progress" rather than as a code. */
export function customerStatus(status: string, lang: DocumentLanguage): string {
  const table = TICKET_TEXT[lang].status as Record<string, string>;
  return table[status] ?? table.open;
}

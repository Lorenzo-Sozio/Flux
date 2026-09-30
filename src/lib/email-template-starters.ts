/**
 * The templates "Create the basic templates" writes: one for each thing the CRM keeps that a
 * customer is written to about — first contact, meetings, quotes, deals won and lost, orders,
 * contracts, invoices and payments, support, and keeping in touch.
 *
 * The texts are in messages/*.json (`emailTemplates.starters.<key>`), in the language of whoever
 * creates them. What is known when the email is sent is a field — the recipient, the sender, the
 * deal, the quote or invoice the email carries (`{{numero_preventivo}}`, `{{importo}}`) — and what
 * only the person knows ("[argomento]") is in square brackets, which the email dialog asks about
 * before sending (`pendingFields`).
 */
import type { PersonalCategory } from "./email-template-rules";

export const STARTER_TEMPLATES: readonly { key: string; category: PersonalCategory }[] = [
  { key: "introduction", category: "intro" },
  { key: "followup", category: "followup" },
  { key: "noReply", category: "followup" },
  { key: "meeting", category: "meeting" },
  { key: "meetingConfirm", category: "meeting" },
  { key: "meetingRecap", category: "meeting" },
  { key: "quote", category: "quote" },
  { key: "quoteFollowup", category: "quote" },
  { key: "quoteExpiring", category: "quote" },
  { key: "quoteAccepted", category: "quote" },
  { key: "dealWon", category: "deal" },
  { key: "dealLost", category: "deal" },
  { key: "orderConfirm", category: "order" },
  { key: "orderShipped", category: "order" },
  { key: "contractSend", category: "contract" },
  { key: "contractRenewal", category: "contract" },
  { key: "invoiceSend", category: "invoice" },
  { key: "paymentReminder", category: "invoice" },
  { key: "paymentOverdue", category: "invoice" },
  { key: "paymentReceived", category: "invoice" },
  { key: "supportAck", category: "support" },
  { key: "supportResolved", category: "support" },
  { key: "reviewRequest", category: "thanks" },
  { key: "reactivation", category: "followup" },
  { key: "thanks", category: "thanks" },
];

/**
 * The fields a starter's text uses, handed to the translator as values: literal braces in a
 * message are ICU syntax, so the messages say `{first}` and this says what it becomes.
 */
export const STARTER_FIELDS = {
  first: "{{nome}}",
  company: "{{azienda}}",
  sender: "{{mittente}}",
  senderEmail: "{{mittente_email}}",
  senderCompany: "{{azienda_mittente}}",
  deal: "{{trattativa}}",
  value: "{{valore}}",
  // The document's: filled by the quote's or invoice's email dialog, never typed by the person.
  quoteNumber: "{{numero_preventivo}}",
  invoiceNumber: "{{numero_fattura}}",
  amount: "{{importo}}",
  dueDate: "{{scadenza}}",
  iban: "{{iban}}",
  orderNumber: "{{numero_ordine}}",
  deliveryDate: "{{data_consegna}}",
  carrier: "{{corriere}}",
  trackingCode: "{{codice_tracciamento}}",
  contractReference: "{{riferimento_contratto}}",
  contractEndDate: "{{fine_contratto}}",
  ticketSubject: "{{oggetto_richiesta}}",
} as const;

/** A starter's text as the editor's HTML: a blank line between paragraphs, a single line break inside one. */
export { paragraphsToHtml as starterBodyHtml } from "./plain-text-html";

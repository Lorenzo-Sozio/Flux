/**
 * email-placeholders.ts — what `{{…}}` means, in one place.
 *
 * Five placeholders existed, in Italian only, listed nowhere the person writing
 * the email could see (audit rilievo S-08). Three things followed from that:
 *
 *  • Someone writing `{{firstName}}` — the obvious guess in an English product —
 *    sent it to a customer exactly as typed.
 *  • `{{azienda}}` was offered in the editor's variable list and substituted
 *    nowhere, so picking it from the menu shipped it raw.
 *  • Only the body was substituted. A subject line reading "A question for
 *    {{nome}}" went out saying that.
 *
 * The catalogue below is the single source for the editor's menu, the
 * substitution at send time, and the warning about a placeholder nobody will
 * ever fill in. Aliases exist so that both languages, and the obvious guesses in
 * each, resolve to the same value rather than to nothing.
 */

export type PlaceholderKey =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "company"
  | "jobTitle"
  | "phone"
  | "unsubscribe"
  | "senderName"
  | "senderEmail"
  | "senderCompany"
  | "dealName"
  | "dealValue"
  | "quoteNumber"
  | "invoiceNumber"
  | "amount"
  | "dueDate"
  | "iban"
  | "orderNumber"
  | "deliveryDate"
  | "carrier"
  | "trackingCode"
  | "contractReference"
  | "contractEndDate"
  | "ticketNumber"
  | "ticketSubject";

/**
 * Whose data a field carries, which decides where it can be filled in:
 * - `recipient` — the person written to: everywhere;
 * - `campaign` — the unsubscribe link: campaigns and sequences only;
 * - `sender` — who writes: a one-to-one email, filled in by the server when it is sent;
 * - `deal` — the deal an email is sent from: only from a deal's page;
 * - `document` — the quote, invoice, order, contract or ticket the email is written from: filled in
 *   by the dialog from that record.
 */
export type PlaceholderScope = "recipient" | "campaign" | "sender" | "deal" | "document";

export interface PlaceholderSpec {
  key: PlaceholderKey;
  scope: PlaceholderScope;
  /** What the editor shows. The first alias is the canonical spelling. */
  aliases: string[];
  label: string;
  description: string;
  /** Used by the preview when there is no real value to hand. */
  sample: string;
  /**
   * The parts in square brackets a template leaves for this value ("[numero preventivo]"): filled
   * like the field when the email carries the document, so nobody types what the CRM knows.
   */
  markers?: string[];
}

export const PLACEHOLDERS: PlaceholderSpec[] = [
  {
    key: "firstName",
    scope: "recipient",
    aliases: ["nome", "firstName", "first_name", "contatto.nome", "contact.firstName"],
    label: "First name",
    description: "The recipient's first name. Empty if the record has none.",
    sample: "Giulia",
  },
  {
    key: "lastName",
    scope: "recipient",
    aliases: ["cognome", "lastName", "last_name", "contatto.cognome", "contact.lastName"],
    label: "Last name",
    description: "The recipient's surname.",
    sample: "Rossi",
  },
  {
    key: "fullName",
    scope: "recipient",
    aliases: ["nomeCompleto", "fullName", "full_name", "nome_completo"],
    label: "Full name",
    description: "First and surname together, with no double space when one is missing.",
    sample: "Giulia Rossi",
  },
  {
    key: "email",
    scope: "recipient",
    aliases: ["email", "mail", "indirizzo_email"],
    label: "Email address",
    description: "The address the message is going to.",
    sample: "giulia.rossi@example.com",
  },
  {
    key: "company",
    scope: "recipient",
    aliases: ["azienda", "company", "companyName", "societa"],
    label: "Company",
    description: "The company on the recipient's record.",
    sample: "Acme S.r.l.",
  },
  {
    key: "jobTitle",
    scope: "recipient",
    aliases: ["ruolo", "jobTitle", "job_title", "posizione"],
    label: "Job title",
    description: "The recipient's role, where the record has one.",
    sample: "Head of Operations",
  },
  {
    key: "phone",
    scope: "recipient",
    aliases: ["telefono", "phone", "tel"],
    label: "Phone",
    description: "The recipient's phone number.",
    sample: "+39 02 1234 5678",
  },
  {
    key: "unsubscribe",
    scope: "campaign",
    aliases: ["link_unsubscribe", "unsubscribe", "link_disiscrizione", "unsubscribeLink"],
    label: "Unsubscribe link",
    description: "Where the recipient goes to stop hearing from you. Added automatically if you leave it out.",
    sample: "https://example.com/unsubscribe",
  },
  {
    key: "senderName",
    scope: "sender",
    aliases: ["mittente", "senderName", "sender", "nome_mittente"],
    label: "Your name",
    description: "The name of whoever sends the email, for the signature.",
    sample: "Marco Bianchi",
  },
  {
    key: "senderEmail",
    scope: "sender",
    aliases: ["mittente_email", "senderEmail", "email_mittente"],
    label: "Your email",
    description: "The sender's own address.",
    sample: "marco.bianchi@example.com",
  },
  {
    key: "senderCompany",
    scope: "sender",
    aliases: ["azienda_mittente", "senderCompany", "nostra_azienda"],
    label: "Your company",
    description: "The workspace's company, as on its quotes and invoices.",
    sample: "Flux S.r.l.",
  },
  {
    key: "dealName",
    scope: "deal",
    aliases: ["trattativa", "dealName", "deal", "opportunita"],
    label: "Deal",
    description: "The name of the deal, when the email is sent from it.",
    sample: "Rinnovo 2027",
  },
  {
    key: "dealValue",
    scope: "deal",
    aliases: ["valore", "dealValue", "valore_trattativa", "importo_trattativa"],
    label: "Deal value",
    description: "The deal's value in its currency, when the email is sent from it.",
    sample: "€ 12.500,00",
  },
  {
    key: "quoteNumber",
    scope: "document",
    aliases: ["numero_preventivo", "quoteNumber", "preventivo"],
    label: "Quote number",
    description: "The number of the quote the email is sending.",
    sample: "P-2026-014",
    markers: ["numero preventivo", "quote number"],
  },
  {
    key: "invoiceNumber",
    scope: "document",
    aliases: ["numero_fattura", "invoiceNumber", "fattura"],
    label: "Invoice number",
    description: "The number of the invoice the email is sending or chasing.",
    sample: "27/2026",
    markers: ["numero fattura", "invoice number"],
  },
  {
    key: "amount",
    scope: "document",
    aliases: ["importo", "amount", "totale"],
    label: "Amount",
    description: "The quote's total, the invoice's total, or what a reminder chases.",
    sample: "€ 1.220,00",
    markers: ["importo", "amount"],
  },
  {
    key: "dueDate",
    scope: "document",
    aliases: ["scadenza", "dueDate", "data_scadenza"],
    label: "Due date",
    description: "Until when the quote is valid, or when the invoice is due.",
    sample: "31/10/2026",
    markers: ["data di scadenza", "due date", "expiry date"],
  },
  {
    key: "iban",
    scope: "document",
    aliases: ["iban"],
    label: "IBAN",
    description: "The account to pay into, on an invoice paid by transfer.",
    sample: "IT60 X054 2811 1010 0000 0123 456",
    markers: ["iban"],
  },
  {
    key: "orderNumber",
    scope: "document",
    aliases: ["numero_ordine", "orderNumber", "ordine"],
    label: "Order number",
    description: "The number of the order the email is written from.",
    sample: "ORD-2026-031",
    markers: ["numero ordine", "order number"],
  },
  {
    key: "deliveryDate",
    scope: "document",
    aliases: ["data_consegna", "deliveryDate", "consegna_prevista"],
    label: "Expected delivery",
    description: "The day the customer was told to expect the order.",
    sample: "15/10/2026",
    markers: ["data di consegna", "delivery date"],
  },
  {
    key: "carrier",
    scope: "document",
    aliases: ["corriere", "carrier"],
    label: "Carrier",
    description: "Who carries the order.",
    sample: "BRT",
    markers: ["corriere", "carrier"],
  },
  {
    key: "trackingCode",
    scope: "document",
    aliases: ["codice_tracciamento", "trackingCode", "tracking"],
    label: "Tracking code",
    description: "The code to follow the shipment.",
    sample: "1Z999AA10123456784",
    markers: ["codice di tracciamento", "tracking code"],
  },
  {
    key: "contractReference",
    scope: "document",
    aliases: ["riferimento_contratto", "contractReference", "contratto"],
    label: "Contract",
    description: "The contract's title, as the customer knows it.",
    sample: "Assistenza annuale 2026",
    markers: ["riferimento contratto", "contract reference"],
  },
  {
    key: "contractEndDate",
    scope: "document",
    aliases: ["fine_contratto", "contractEndDate", "data_fine_contratto"],
    label: "Contract end date",
    description: "When the contract's current term ends, renewals included.",
    sample: "31/12/2026",
    markers: ["data di fine contratto", "contract end date"],
  },
  {
    key: "ticketNumber",
    scope: "document",
    aliases: ["numero_richiesta", "ticketNumber", "richiesta"],
    label: "Request number",
    description: "The support request's number.",
    sample: "TCK-0142",
  },
  {
    key: "ticketSubject",
    scope: "document",
    aliases: ["oggetto_richiesta", "ticketSubject"],
    label: "Request subject",
    description: "What the support request is about, as its subject says.",
    sample: "Stampante non collegata",
  },
];

/** Every alias, lowercased, pointing at the value it stands for. */
const BY_ALIAS = new Map<string, PlaceholderKey>(
  PLACEHOLDERS.flatMap((p) => p.aliases.map((a) => [a.toLowerCase(), p.key] as const)),
);

/** Every bracketed part a template leaves for a value, lowercased. */
const BY_MARKER = new Map<string, PlaceholderKey>(
  PLACEHOLDERS.flatMap((p) => (p.markers ?? []).map((m) => [m, p.key] as const)),
);

/** A part the person is meant to write in by hand: "[quote number]", "[data di scadenza]". */
const MARKER = /\[([^\]\n]{2,60})\]/g;

/** Matches `{{ anything }}`, tolerating the spaces people leave in. */
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export type PlaceholderValues = Partial<Record<PlaceholderKey, string | null | undefined>>;

/**
 * Fills in every placeholder the catalogue knows.
 *
 * One left unknown is left exactly as written, rather than blanked. A visible
 * `{{oggetto}}` in a test send is a bug someone can fix; a silently empty line
 * is one nobody notices until a customer does.
 */
export function renderPlaceholders(text: string, values: PlaceholderValues): string {
  return text
    .replace(TOKEN, (whole, name: string) => {
      const key = BY_ALIAS.get(name.toLowerCase());
      if (!key) return whole;
      const value = values[key];
      // ⚠️ Not given at all is not the same as given empty: a field this caller cannot fill (the
      // sender's, filled in later by the server) is left for whoever can.
      if (value === undefined) return whole;
      return value ?? "";
    })
    .replace(MARKER, (whole, name: string) => {
      const key = BY_MARKER.get(name.trim().toLowerCase());
      const value = key ? values[key] : undefined;
      // ⚠️ Only a real value replaces a bracket: an empty one (a quote with no expiry) leaves it
      // there, where the dialog asks about it, instead of a sentence with a hole in it.
      return value ? value : whole;
    });
}

/**
 * Placeholders written into the text that nothing will ever fill in.
 *
 * The editor shows these before the campaign goes out, which is the whole point:
 * the alternative is a customer reading `{{firstName}}`.
 */
export function findUnknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1];
    if (!BY_ALIAS.has(name.toLowerCase())) unknown.add(name);
  }
  return [...unknown];
}

/** True when the text carries an unsubscribe placeholder in any of its spellings. */
export function hasUnsubscribePlaceholder(text: string): boolean {
  for (const match of text.matchAll(TOKEN)) {
    if (BY_ALIAS.get(match[1].toLowerCase()) === "unsubscribe") return true;
  }
  return false;
}

/**
 * Guarantees a way out.
 *
 * A marketing email without an unsubscribe link is not a rendering defect, it is
 * an unlawful one, and the failure looks exactly like a successful send. Rather
 * than refuse to send — which would leave the campaign stuck with no way for the
 * user to fix it from where they are — the link is appended when it is missing.
 */
export function ensureUnsubscribe(html: string, url: string): string {
  if (hasUnsubscribePlaceholder(html)) return renderPlaceholders(html, { unsubscribe: url });

  const footer =
    `<p style="margin:24px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;text-align:center;">` +
    `<a href="${url}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a></p>`;

  // Inside the body where there is one, so it inherits the email's own width and
  // background instead of hanging below the layout.
  const closingBody = html.lastIndexOf("</body>");
  if (closingBody !== -1) return `${html.slice(0, closingBody)}${footer}${html.slice(closingBody)}`;
  return `${html}\n${footer}`;
}

/** The values for a real recipient, in the shape `renderPlaceholders` wants. */
export function valuesForRecipient(r: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  unsubscribeUrl?: string | null;
}): PlaceholderValues {
  return {
    firstName: r.firstName ?? "",
    lastName: r.lastName ?? "",
    fullName: [r.firstName, r.lastName].filter(Boolean).join(" "),
    email: r.email ?? "",
    company: r.company ?? "",
    jobTitle: r.jobTitle ?? "",
    phone: r.phone ?? "",
    unsubscribe: r.unsubscribeUrl ?? "",
  };
}

/** Example values, for the editor's preview when no recipient is chosen. */
export function sampleValues(): PlaceholderValues {
  return Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.sample])) as PlaceholderValues;
}

/** The sender's fields, for a one-to-one email: filled in by the server, which knows who sends. */
export function senderValues(s: {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}): PlaceholderValues {
  return { senderName: s.name ?? "", senderEmail: s.email ?? "", senderCompany: s.company ?? "" };
}

/** The fields of the quote or invoice an email carries, already written in the customer's language. */
export function documentValues(d: {
  quoteNumber?: string | null;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  deliveryDate?: string | null;
  carrier?: string | null;
  trackingCode?: string | null;
  contractReference?: string | null;
  contractEndDate?: string | null;
  ticketNumber?: string | null;
  ticketSubject?: string | null;
  amount?: string | null;
  dueDate?: string | null;
  iban?: string | null;
}): PlaceholderValues {
  // Only what was given: a quote's email must not blank an order's field it knows nothing about,
  // which would hide it from the dialog's question instead of leaving it to be asked.
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v != null && v !== "")) as PlaceholderValues;
}

/** The deal's fields, for an email sent from its page. */
export function dealValues(d: { name?: string | null; value?: string | null }): PlaceholderValues {
  return { dealName: d.name ?? "", dealValue: d.value ?? "" };
}

/**
 * What would still reach the customer unfilled: a part in square brackets left from a template,
 * a field nothing knows, or a deal's field in an email not sent from a deal. The dialog asks
 * before sending any of these — "[numero fattura]" in a customer's inbox reads as carelessness.
 */
export function pendingFields(text: string, opts: { deal: boolean }): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MARKER)) out.add(m[0]);
  for (const m of text.matchAll(TOKEN)) {
    const key = BY_ALIAS.get(m[1].toLowerCase());
    const spec = key ? PLACEHOLDERS.find((p) => p.key === key) : undefined;
    // A document's field still here was not filled by the dialog: there is no document to fill it.
    if (!spec || (spec.scope === "deal" && !opts.deal) || spec.scope === "campaign" || spec.scope === "document")
      out.add(m[0]);
  }
  return [...out];
}

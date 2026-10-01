/**
 * The language a document is written in for its customer, and the texts it uses.
 *
 * ⚠️⚠️ **The customer's language, not the reader's.** The dashboard follows the
 * language of whoever is signed in; a quote, its print view, its public page and
 * the email that carries it follow the language on the customer's record. An
 * Italian salesperson sending an offer to a German buyer sends it in English.
 *
 * ⚠️ A record with no language set is read from its country: an Italian address,
 * or no country at all, is Italian; anything else is English. So the workspaces
 * that existed before the field did get the right answer without anyone filling
 * it in.
 *
 * The texts live here rather than in messages/*.json because they are rendered
 * where next-intl is not — react-pdf on the server, an HTML string, an email —
 * and because `satisfies Record<DocumentLanguage, …>` makes a missing translation a
 * compile error instead of an English word in an Italian PDF.
 */

export const DOCUMENT_LANGUAGES = ["it", "en"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

const ITALY = new Set(["it", "ita", "italy", "italia"]);

export function isDocumentLanguage(value: unknown): value is DocumentLanguage {
  return typeof value === "string" && (DOCUMENT_LANGUAGES as readonly string[]).includes(value);
}

/** The customer's chosen language, or the one their country implies. */
export function documentLanguage(customer: { language?: string | null; country?: string | null } | null | undefined) {
  if (isDocumentLanguage(customer?.language)) return customer.language;
  const country = customer?.country?.trim().toLowerCase();
  return !country || ITALY.has(country) ? "it" : "en";
}

/** Number and date conventions for each language. */
export const DOCUMENT_LOCALE: Record<DocumentLanguage, string> = { it: "it-IT", en: "en-GB" };

/**
 * An amount in the document's own currency. Never converted: the figure on a
 * document is the figure the customer was offered.
 */
export function formatDocumentMoney(
  amount: number | string | null | undefined,
  currency: string,
  lang: DocumentLanguage,
) {
  const value = typeof amount === "string" ? Number.parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat(DOCUMENT_LOCALE[lang], {
    style: "currency",
    currency: currency || "EUR",
    // Italian leaves four-digit amounts ungrouped by default; invoices and offers do not.
    useGrouping: "always",
  }).format(Number.isFinite(value) ? value : 0);
}

/** A calendar date, e.g. "16 settembre 2026" or "16 September 2026". */
export function formatDocumentDate(value: Date | string | null | undefined, lang: DocumentLanguage) {
  if (!value) return "—";
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(DOCUMENT_LOCALE[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(date);
}

/** A percentage as the language writes it: "22%" / "22 %" differ, decimals use its separator. */
export function formatDocumentPercent(value: number | string | null | undefined, lang: DocumentLanguage) {
  const n = typeof value === "string" ? Number.parseFloat(value) : (value ?? 0);
  return `${new Intl.NumberFormat(DOCUMENT_LOCALE[lang], { maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)}%`;
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export const QUOTE_TEXT = {
  it: {
    documentTitle: "Preventivo",
    subtitle: "Offerta commerciale",
    billTo: "Destinatario",
    vat: "P.IVA",
    details: "Dettagli",
    issued: "Emesso il",
    expires: "Valido fino al",
    reference: "Riferimento",
    contactPerson: "Referente",
    description: "Descrizione",
    quantity: "Q.tà",
    unitPrice: "Prezzo unit.",
    discount: "Sconto",
    tax: "IVA",
    lineTotal: "Totale",
    subtotal: "Imponibile",
    discountOn: "Sconto",
    taxOn: "IVA",
    total: "Totale",
    notes: "Note e condizioni",
    generated: "Generato il",
    page: "Pagina",
    print: "Stampa / Salva come PDF",
    receivedFrom: "Hai ricevuto un preventivo da",
    accept: "Accetta il preventivo",
    decline: "Rifiuta",
    declineReason: "Motivo del rifiuto (facoltativo)",
    declinePlaceholder: "Facci sapere perché, così possiamo migliorare la proposta.",
    confirmDecline: "Conferma il rifiuto",
    cancel: "Annulla",
    acceptedTitle: "Preventivo accettato",
    acceptedBody: "Grazie. Abbiamo ricevuto la tua conferma e ti contatteremo a breve.",
    signTitle: "Firma per accettare",
    signName: "Nome e cognome",
    signNamePlaceholder: "Scrivi il tuo nome per firmare",
    signConsent:
      "Accetto il preventivo {number} e le sue condizioni. Scrivendo il mio nome qui sopra lo firmo con firma elettronica semplice.",
    signNote: "Registriamo il nome, la data e l'ora, l'indirizzo IP e l'impronta del documento firmato.",
    signAndAccept: "Firma e accetta",
    signatureRequired: "Scrivi il tuo nome e spunta la casella per firmare.",
    signedBy: "Firmato da {name} il {date}",
    declinedTitle: "Preventivo rifiutato",
    declinedBody: "Grazie per averci risposto.",
    somethingWrong: "Qualcosa è andato storto. Riprova.",
    networkError: "Errore di rete. Controlla la connessione e riprova.",
    notFound: "Preventivo non trovato o link non più valido.",
    expired: "Questo preventivo è scaduto. Chiedine uno aggiornato.",
    notActionable: "Questo preventivo non può più essere accettato o rifiutato.",
    emailSubject: "Preventivo {number}",
    emailGreeting: "Gentile cliente,",
    emailBody: "le inviamo il nostro preventivo n. {number}, per un totale di {total}.",
    emailValidUntil: "L'offerta è valida fino al {date}.",
    emailCta: "Apri e firma il preventivo",
    emailCtaHint:
      "Si apre nel browser: può leggerlo, scaricarlo in PDF e accettarlo con una firma, senza stampare nulla.",
    emailNumber: "Numero",
    emailPreheader: "Il preventivo n. {number} di {total}, valido fino al {date}.",
    emailPreheaderNoDate: "Il preventivo n. {number} di {total}.",
    emailDefaultMessage:
      "Gentile cliente,\n\nle inviamo il preventivo richiesto. Resto a disposizione per qualsiasi chiarimento.\n\nCordiali saluti",
    emailSignoff: "Cordiali saluti,",
    reviewPrompt: "Esamina il preventivo qui sopra e comunicaci se lo accetti o lo rifiuti.",
    back: "Indietro",
    sentBy: "Questo preventivo ti è stato inviato da {name}.",
    statuses: {
      draft: "Bozza",
      pending_approval: "In approvazione",
      approved: "Approvato",
      sent: "Inviato",
      viewed: "Visualizzato",
      accepted: "Accettato",
      declined: "Rifiutato",
      expired: "Scaduto",
      converted: "Convertito in ordine",
    },
  },
  en: {
    documentTitle: "Quote",
    subtitle: "Commercial proposal",
    billTo: "Bill to",
    vat: "VAT",
    details: "Details",
    issued: "Issued",
    expires: "Valid until",
    reference: "Reference",
    contactPerson: "Contact",
    description: "Description",
    quantity: "Qty",
    unitPrice: "Unit price",
    discount: "Disc.",
    tax: "VAT",
    lineTotal: "Total",
    subtotal: "Subtotal",
    discountOn: "Discount",
    taxOn: "VAT",
    total: "Total",
    notes: "Notes and terms",
    generated: "Generated on",
    page: "Page",
    print: "Print / Save as PDF",
    receivedFrom: "You have received a quote from",
    accept: "Accept quote",
    decline: "Decline",
    declineReason: "Reason for declining (optional)",
    declinePlaceholder: "Let us know why, so we can improve the proposal.",
    confirmDecline: "Confirm decline",
    cancel: "Cancel",
    acceptedTitle: "Quote accepted",
    acceptedBody: "Thank you. We have received your confirmation and will be in touch shortly.",
    signTitle: "Sign to accept",
    signName: "Full name",
    signNamePlaceholder: "Type your name to sign",
    signConsent:
      "I accept quote {number} and its terms. By typing my name above I sign it with a simple electronic signature.",
    signNote: "We record the name, the date and time, the IP address and the fingerprint of the signed document.",
    signAndAccept: "Sign and accept",
    signatureRequired: "Type your name and tick the box to sign.",
    signedBy: "Signed by {name} on {date}",
    declinedTitle: "Quote declined",
    declinedBody: "Thank you for letting us know.",
    somethingWrong: "Something went wrong. Please try again.",
    networkError: "Network error. Check your connection and try again.",
    notFound: "Quote not found, or the link is no longer valid.",
    expired: "This quote has expired. Please ask for an updated one.",
    notActionable: "This quote can no longer be accepted or declined.",
    emailSubject: "Quote {number}",
    emailGreeting: "Dear customer,",
    emailBody: "here is our quote no. {number}, for a total of {total}.",
    emailValidUntil: "The offer is valid until {date}.",
    emailCta: "Open and sign the quote",
    emailCtaHint:
      "It opens in your browser: read it, download the PDF and accept it with a signature, nothing to print.",
    emailNumber: "Number",
    emailPreheader: "Quote no. {number} for {total}, valid until {date}.",
    emailPreheaderNoDate: "Quote no. {number} for {total}.",
    emailDefaultMessage:
      "Dear customer,\n\nplease find the quote you requested. I remain available for any questions.\n\nKind regards",
    emailSignoff: "Kind regards,",
    reviewPrompt: "Please review the quote above and accept or decline it.",
    back: "Back",
    sentBy: "This quote was sent to you by {name}.",
    statuses: {
      draft: "Draft",
      pending_approval: "Pending approval",
      approved: "Approved",
      sent: "Sent",
      viewed: "Viewed",
      accepted: "Accepted",
      declined: "Declined",
      expired: "Expired",
      converted: "Converted to order",
    },
  },
} satisfies Record<DocumentLanguage, Record<string, string | Record<string, string>>>;

export type QuoteText = (typeof QUOTE_TEXT)["it"];

/** A status as the customer reads it; an unknown one is shown as stored rather than hidden. */
export function quoteStatusText(status: string, lang: DocumentLanguage): string {
  return (QUOTE_TEXT[lang].statuses as Record<string, string>)[status] ?? status;
}

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? String(values[key]) : m));
}

// ─── Invoice courtesy copy ────────────────────────────────────────────────────

export const INVOICE_TEXT = {
  it: {
    invoice: "Fattura",
    creditNote: "Nota di credito",
    number: "n.",
    dated: "del",
    creditNoteReference: "rif. fattura n. {number} del {date}",
    // I11: a deposit invoice (TD02), and the balance invoice that takes deposits off.
    depositInvoice: "Fattura d'acconto",
    depositLine: "Acconto sull'ordine {order}",
    depositLineRate: "Acconto sull'ordine {order} (IVA {rate})",
    deductionLine: "Storno acconto fattura n. {number} del {date}",
    deductionsReference: "Detratti gli acconti: {list}",
    creditNoteNote: "Storno totale della fattura n. {number} del {date}",
    creditLine: "Storno della fattura n. {number} del {date} (IVA {rate})",
    creditLineNature: "Storno della fattura n. {number} del {date} ({nature})",
    customer: "Cliente",
    sdiDelivery: "Recapito SDI",
    recipientCode: "Codice destinatario",
    pec: "PEC",
    issuerRegime: "Regime fiscale emittente",
    vat: "P.IVA",
    fiscalCode: "C.F.",
    description: "Descrizione",
    quantity: "Q.tà",
    price: "Prezzo",
    discount: "Sc. %",
    rate: "IVA",
    amount: "Importo",
    payment: "Pagamento",
    due: "Scadenza",
    installment: "Rata",
    exemptOperations: "Operazioni senza IVA",
    notes: "Note",
    taxable: "Imponibile",
    vatOn: "IVA {rate} su {taxable}",
    natureOn: "{nature} su {taxable}",
    documentTotal: "Totale documento",
    documentDiscount: "Sconto sul documento {percent}",
    stampNotice: "Imposta di bollo assolta in modo virtuale ai sensi dell'art. 6 del D.M. 17 giugno 2014.",
    courtesyNotice:
      "Copia di cortesia priva di valore fiscale ai sensi dell'art. 21 del D.P.R. 633/1972. La fattura elettronica originale è quella trasmessa tramite il Sistema di Interscambio (SDI) ed è disponibile nell'area riservata del sito dell'Agenzia delle Entrate.",
    emailGreeting: "Gentile cliente,",
    emailBody: "in allegato la copia di cortesia della {label} n. {number} del {date}, di importo {total}",
    emailPreheader: "{label} n. {number} di {total}.",
    reminderSubject: "Sollecito di pagamento",
    reminderBody:
      "le scriviamo per ricordarle che risulta ancora da saldare la {label} n. {number} del {date}, scaduta il {due}. L'importo scaduto è di {amount}",
    reminderOverdue: "Scaduta da {days} giorni",
    reminderOverdueOne: "Scaduta da 1 giorno",
    reminderPreheader: "Un promemoria per la {label} n. {number}, scaduta il {due}.",
    reminderReply: "Per qualsiasi chiarimento può rispondere direttamente a questa email.",
    documentRow: "n. {number} del {date}",
    reminderPaid:
      "Se ha già provveduto al pagamento, la preghiamo di non tenere conto di questo messaggio e di scusarci per il disturbo.",
    emailSignoff: "Cordiali saluti,",
    emailNotice:
      "Il PDF allegato è una copia di cortesia priva di valore fiscale. La fattura elettronica originale è quella trasmessa tramite il Sistema di Interscambio (SDI) ed è disponibile nell'area riservata del sito dell'Agenzia delle Entrate.",
  },
  en: {
    invoice: "Invoice",
    creditNote: "Credit note",
    number: "no.",
    dated: "of",
    creditNoteReference: "ref. invoice no. {number} of {date}",
    depositInvoice: "Deposit invoice",
    depositLine: "Deposit on order {order}",
    depositLineRate: "Deposit on order {order} (VAT {rate})",
    deductionLine: "Deposit invoice no. {number} of {date} deducted",
    deductionsReference: "Deposits deducted: {list}",
    creditNoteNote: "Full credit of invoice no. {number} of {date}",
    creditLine: "Credit of invoice no. {number} of {date} (VAT {rate})",
    creditLineNature: "Credit of invoice no. {number} of {date} ({nature})",
    customer: "Customer",
    sdiDelivery: "SDI delivery",
    recipientCode: "Recipient code",
    pec: "Certified email (PEC)",
    issuerRegime: "Issuer tax regime",
    vat: "VAT",
    fiscalCode: "Tax code",
    description: "Description",
    quantity: "Qty",
    price: "Price",
    discount: "Disc. %",
    rate: "VAT",
    amount: "Amount",
    payment: "Payment",
    due: "Due",
    installment: "Installment",
    exemptOperations: "Operations without VAT",
    notes: "Notes",
    taxable: "Taxable amount",
    vatOn: "VAT {rate} on {taxable}",
    natureOn: "{nature} on {taxable}",
    documentTotal: "Document total",
    documentDiscount: "Document discount {percent}",
    stampNotice:
      "Stamp duty paid virtually under art. 6 of the Ministerial Decree of 17 June 2014 (imposta di bollo assolta in modo virtuale).",
    // ⚠️ The Italian wording stays: it is the legal notice, and the English is its translation.
    courtesyNotice:
      "Courtesy copy with no fiscal value (copia di cortesia priva di valore fiscale, art. 21 D.P.R. 633/1972). The original electronic invoice is the one transmitted through the Italian Exchange System (SDI).",
    emailGreeting: "Dear customer,",
    emailBody: "please find attached the courtesy copy of {label} no. {number} of {date}, for {total}",
    emailPreheader: "{label} no. {number} for {total}.",
    reminderSubject: "Payment reminder",
    reminderBody:
      "this is a reminder that {label} no. {number} of {date}, due on {due}, has not been paid yet. The overdue amount is {amount}",
    reminderOverdue: "Overdue by {days} days",
    reminderOverdueOne: "Overdue by 1 day",
    reminderPreheader: "A reminder about {label} no. {number}, due on {due}.",
    reminderReply: "If you have any questions, simply reply to this email.",
    documentRow: "no. {number} of {date}",
    reminderPaid: "If you have already paid, please disregard this message, and accept our apologies.",
    emailSignoff: "Kind regards,",
    emailNotice:
      "The attached PDF is a courtesy copy with no fiscal value. The original electronic invoice is the one transmitted through the Italian Exchange System (SDI).",
  },
} satisfies Record<DocumentLanguage, Record<string, string>>;

export type InvoiceText = (typeof INVOICE_TEXT)["it"];

/** FatturaPA payment method codes, as the customer reads them. */
export const PAYMENT_METHOD_TEXT: Record<DocumentLanguage, Record<string, string>> = {
  it: {
    MP01: "Contanti",
    MP02: "Assegno",
    MP05: "Bonifico",
    MP08: "Carta di pagamento",
    MP12: "RIBA",
    MP19: "Addebito diretto SEPA (SDD)",
    MP23: "PagoPA",
  },
  en: {
    MP01: "Cash",
    MP02: "Cheque",
    MP05: "Bank transfer",
    MP08: "Payment card",
    MP12: "RIBA (bank receipt)",
    MP19: "SEPA Direct Debit",
    MP23: "PagoPA",
  },
};

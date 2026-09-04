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
  | "unsubscribe";

export interface PlaceholderSpec {
  key: PlaceholderKey;
  /** What the editor shows. The first alias is the canonical spelling. */
  aliases: string[];
  label: string;
  description: string;
  /** Used by the preview when there is no real value to hand. */
  sample: string;
}

export const PLACEHOLDERS: PlaceholderSpec[] = [
  {
    key: "firstName",
    aliases: ["nome", "firstName", "first_name", "contatto.nome", "contact.firstName"],
    label: "First name",
    description: "The recipient's first name. Empty if the record has none.",
    sample: "Giulia",
  },
  {
    key: "lastName",
    aliases: ["cognome", "lastName", "last_name", "contatto.cognome", "contact.lastName"],
    label: "Last name",
    description: "The recipient's surname.",
    sample: "Rossi",
  },
  {
    key: "fullName",
    aliases: ["nomeCompleto", "fullName", "full_name", "nome_completo"],
    label: "Full name",
    description: "First and surname together, with no double space when one is missing.",
    sample: "Giulia Rossi",
  },
  {
    key: "email",
    aliases: ["email", "mail", "indirizzo_email"],
    label: "Email address",
    description: "The address the message is going to.",
    sample: "giulia.rossi@example.com",
  },
  {
    key: "company",
    aliases: ["azienda", "company", "companyName", "societa"],
    label: "Company",
    description: "The company on the recipient's record.",
    sample: "Acme S.r.l.",
  },
  {
    key: "jobTitle",
    aliases: ["ruolo", "jobTitle", "job_title", "posizione"],
    label: "Job title",
    description: "The recipient's role, where the record has one.",
    sample: "Head of Operations",
  },
  {
    key: "phone",
    aliases: ["telefono", "phone", "tel"],
    label: "Phone",
    description: "The recipient's phone number.",
    sample: "+39 02 1234 5678",
  },
  {
    key: "unsubscribe",
    aliases: ["link_unsubscribe", "unsubscribe", "link_disiscrizione", "unsubscribeLink"],
    label: "Unsubscribe link",
    description: "Where the recipient goes to stop hearing from you. Added automatically if you leave it out.",
    sample: "https://example.com/unsubscribe",
  },
];

/** Every alias, lowercased, pointing at the value it stands for. */
const BY_ALIAS = new Map<string, PlaceholderKey>(
  PLACEHOLDERS.flatMap((p) => p.aliases.map((a) => [a.toLowerCase(), p.key] as const)),
);

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
  return text.replace(TOKEN, (whole, name: string) => {
    const key = BY_ALIAS.get(name.toLowerCase());
    if (!key) return whole;
    const value = values[key];
    return value ?? "";
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

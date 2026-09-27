/**
 * Which field of a record a spreadsheet column fills — the part of the CSV import with no
 * database in it, so the import wizard in the browser suggests the same mapping the server
 * would have guessed (src/lib/csv-import.ts).
 */

export type CsvEntity = "contacts" | "leads" | "companies";

/**
 * Header spellings each field answers to, compared after lower-casing and dropping
 * spaces, underscores, dashes, dots and accents. camelCase is what Flux exports, so an
 * export always imports back; snake_case and Italian are what a spreadsheet from anywhere
 * else is likely to carry.
 */
const PERSON: Record<string, string[]> = {
  firstName: ["firstname", "nome", "name"],
  lastName: ["lastname", "cognome", "surname"],
  email: ["email", "mail", "indirizzoemail", "posta"],
  phone: ["phone", "telefono", "tel", "telephone"],
  mobile: ["mobile", "cellulare", "cell", "mobilephone"],
  jobTitle: ["jobtitle", "title", "ruolo", "qualifica", "posizione"],
  street: ["street", "address", "indirizzo", "via"],
  city: ["city", "citta", "comune"],
  state: ["state", "province", "provincia", "regione"],
  zipCode: ["zipcode", "zip", "postalcode", "cap"],
  country: ["country", "paese", "nazione"],
  source: ["source", "fonte", "origine"],
  notes: ["notes", "note"],
  tags: ["tags", "tag", "etichette"],
  marketingConsent: ["marketingconsent", "consenso", "consensomarketing"],
  leadScore: ["leadscore", "score", "punteggio"],
};

export const ALIASES: Record<CsvEntity, Record<string, string[]>> = {
  contacts: {
    ...PERSON,
    department: ["department", "reparto", "dipartimento"],
    linkedinUrl: ["linkedinurl", "linkedin"],
    company: ["company", "companyname", "azienda", "societa", "ragionesociale"],
  },
  leads: {
    ...PERSON,
    companyName: ["companyname", "company", "azienda", "societa", "ragionesociale"],
    industry: ["industry", "settore"],
    website: ["website", "sito", "sitoweb", "url"],
    status: ["status", "stato"],
    rating: ["rating", "valutazione"],
  },
  companies: {
    name: ["name", "companyname", "company", "azienda", "ragionesociale", "denominazione"],
    industry: ["industry", "settore"],
    website: ["website", "sito", "sitoweb", "url"],
    description: ["description", "descrizione"],
    type: ["type", "tipo"],
    employeeCount: ["employeecount", "dipendenti", "numerodipendenti"],
    annualRevenue: ["annualrevenue", "fatturato"],
    street: ["street", "address", "indirizzo", "via"],
    city: ["city", "citta", "comune"],
    state: ["state", "province", "provincia", "regione"],
    zipCode: ["zipcode", "zip", "postalcode", "cap"],
    country: ["country", "paese", "nazione"],
    mainPhone: ["mainphone", "phone", "telefono", "tel"],
    mainEmail: ["mainemail", "email", "mail"],
    linkedinUrl: ["linkedinurl", "linkedin"],
    source: ["source", "fonte", "origine"],
    vatNumber: ["vatnumber", "vat", "partitaiva", "piva"],
    sdiCode: ["sdicode", "sdi", "codicesdi", "codicedestinatario"],
    fiscalCode: ["fiscalcode", "codicefiscale", "cf"],
    pec: ["pec"],
    language: ["language", "lingua"],
    tags: ["tags", "tag", "etichette"],
  },
};

export const BOOLEAN_FIELDS = new Set(["marketingConsent"]);
export const LIST_FIELDS = new Set(["tags"]);
export const LOWERCASE_FIELDS = new Set(["status", "rating", "type", "language"]);

export function normaliseHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_.\-']/g, "");
}

export function headerMap(entity: CsvEntity): Map<string, string> {
  const map = new Map<string, string>();
  for (const [field, spellings] of Object.entries(ALIASES[entity])) {
    for (const s of spellings) if (!map.has(s)) map.set(s, field);
  }
  return map;
}

/** The fields a column can be mapped to, in the order the wizard offers them. */
export function importFields(entity: CsvEntity): string[] {
  return Object.keys(ALIASES[entity]);
}

/** Fields a row cannot be imported without — what the API validators require. */
export const REQUIRED_FIELDS: Record<CsvEntity, string[]> = {
  contacts: ["firstName", "lastName"],
  leads: [],
  companies: ["name"],
};

/** A lead needs any one of these, not all of them (validateLeadInput). */
export const AT_LEAST_ONE: Partial<Record<CsvEntity, string[]>> = {
  leads: ["firstName", "lastName", "email", "phone"],
};

/** What each field is matched on to find a record that already exists. */
export const DEDUP_FIELD: Record<CsvEntity, string> = { contacts: "email", leads: "email", companies: "name" };

/**
 * The field each header would fill, guessed from its spelling ("" when nothing matches).
 * Two headers never claim the same field: the first one wins, as it does on the server.
 */
export function suggestMapping(entity: CsvEntity, headers: string[]): Record<string, string> {
  const map = headerMap(entity);
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const h of headers) {
    const field = map.get(normaliseHeader(h)) ?? "";
    out[h] = field && !used.has(field) ? field : "";
    if (out[h]) used.add(out[h]);
  }
  return out;
}

/**
 * A row renamed by the mapping the person confirmed: `{ header: field }`, "" to ignore a
 * column. The result carries field names, which rowToInput reads as their own spelling.
 */
export function applyMapping(row: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(row)) {
    const field = mapping[header];
    if (field && !(field in out)) out[field] = value;
  }
  return out;
}

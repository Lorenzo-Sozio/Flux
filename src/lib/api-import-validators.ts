export type OnDuplicate = "skip" | "update" | "error";

export interface ValidationError {
  field: string;
  message: string;
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

function mkErr(field: string, message: string): ValidationError {
  return { field, message };
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function str(v: unknown): string | null {
  if (!isStr(v) || v.trim() === "") return null;
  return v.trim();
}

function chkRequired(v: unknown, field: string): ValidationError | null {
  if (!isStr(v) || v.trim().length === 0) return mkErr(field, `${field} is required`);
  return null;
}

function chkEmail(v: unknown, field: string): ValidationError | null {
  if (v == null || v === "") return null;
  if (!isStr(v)) return mkErr(field, `${field} must be a string`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return mkErr(field, `${field} is not a valid email address`);
  return null;
}

function chkUrl(v: unknown, field: string): ValidationError | null {
  if (v == null || v === "") return null;
  if (!isStr(v)) return mkErr(field, `${field} must be a string`);
  try {
    new URL(v.trim());
  } catch (_e) {
    return mkErr(field, `${field} is not a valid URL`);
  }
  return null;
}

function chkEnum(v: unknown, field: string, allowed: readonly string[]): ValidationError | null {
  if (v == null || v === "") return null;
  if (!isStr(v)) return mkErr(field, `${field} must be a string`);
  if (!allowed.includes(v)) return mkErr(field, `${field} must be one of: ${allowed.join(", ")}`);
  return null;
}

function chkStr(v: unknown, field: string, maxLen = 1000): ValidationError | null {
  if (v == null) return null;
  if (!isStr(v)) return mkErr(field, `${field} must be a string`);
  if (v.length > maxLen) return mkErr(field, `${field} must be ${maxLen} characters or fewer`);
  return null;
}

function chkInt(v: unknown, field: string, min?: number, max?: number): ValidationError | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) return mkErr(field, `${field} must be an integer`);
  if (min !== undefined && n < min) return mkErr(field, `${field} must be at least ${min}`);
  if (max !== undefined && n > max) return mkErr(field, `${field} must be at most ${max}`);
  return null;
}

function chkBool(v: unknown, field: string): ValidationError | null {
  if (v == null) return null;
  if (typeof v !== "boolean" && v !== "true" && v !== "false" && v !== 1 && v !== 0) {
    return mkErr(field, `${field} must be a boolean`);
  }
  return null;
}

function parseBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  return false;
}

function collect(...items: (ValidationError | null)[]): ValidationError[] {
  return items.filter((e): e is ValidationError => e !== null);
}

function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map(String).filter(Boolean);
}

/**
 * The digits of a phone number, for **matching** — never for storing.
 *
 * What is stored stays exactly as the caller typed it: people recognise their own number
 * by its spacing, and rewriting it would make the CRM show something nobody entered. This
 * is only used to answer "is this the same number as that one?".
 *
 * ## ⚠️ Deliberately conservative, and this is the important part
 *
 * Two spellings of the same **international** number match: `+39 333 111 2223` and
 * `+393331112223` both become `393331112223`, and a leading `00` is treated as the `+` it
 * stands for. Measured on the running instance on 2026-09-01, those two produced two
 * separate leads with two ids.
 *
 * A **national** number does not match its international form: `3331112223` stays
 * `3331112223`. Making it match would mean guessing a country, and a wrong guess merges
 * two different people into one record — which is far worse than keeping two records for
 * one person. A duplicate is visible and fixable; a merge silently destroys the fact that
 * there were two, and the next message goes to whichever one survived.
 *
 * Returns null when there is nothing to match on, so a caller cannot accidentally treat
 * "no number" as a value that equals another "no number".
 */
export function digitsForMatching(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Under nine digits is not a phone number anywhere, and matching on "12" would put
  // strangers in the same record.
  return digits.length >= 9 ? digits : null;
}

/**
 * A lead is identified by whatever we actually know about it — a name, an email, or a
 * phone number. Requiring `firstName` and `lastName` was requiring the one thing a phone
 * call rarely offers: nobody gives a surname before saying hello.
 */
function identifica(b: Record<string, unknown>): boolean {
  return Boolean(str(b.firstName) || str(b.lastName) || str(b.email) || str(b.phone));
}

/**
 * The display name for a lead that has no name yet.
 *
 * ⚠️ The two columns stay NOT NULL, and that is the whole point: 63 places in this
 * codebase compose a lead's name by hand, with no shared helper. Making them nullable
 * would print "null null" across the app in exchange for a data model nobody asked for.
 *
 * So a nameless lead is called by its contact point, which is honest — it is exactly what
 * is known about the person — and it is what a CRM shows for an unknown caller anyway.
 * The last name is empty rather than a placeholder: an invented "Unknown" would be a fact
 * this code made up, and someone would eventually filter on it.
 */
function nomeDaRecapito(b: Record<string, unknown>): { firstName: string; lastName: string } {
  const nome = str(b.firstName) ?? "";
  const cognome = str(b.lastName) ?? "";
  if (nome || cognome) return { firstName: nome, lastName: cognome };
  return { firstName: str(b.phone) ?? str(b.email) ?? "", lastName: "" };
}

// ─── Lead ─────────────────────────────────────────────────────────────────────

export interface LeadInput {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  companyName: string | null;
  industry: string | null;
  website: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  status: string;
  source: string | null;
  rating: string | null;
  leadScore: number | null;
  notes: string | null;
  marketingConsent: boolean;
  tags: string[];
}

const LEAD_STATUSES = ["new", "contacting", "engaged", "qualified", "unqualified"] as const;
const LEAD_RATINGS = ["hot", "warm", "cold"] as const;

export function validateLeadInput(body: unknown): { errors: ValidationError[]; data: LeadInput | null } {
  if (typeof body !== "object" || body === null) {
    return { errors: [mkErr("body", "Request body must be a JSON object")], data: null };
  }
  const b = body as Record<string, unknown>;

  const errors = collect(
    identifica(b)
      ? null
      : mkErr("identity", "a lead needs at least one of firstName, lastName, email or phone"),
    chkStr(b.firstName, "firstName", 200),
    chkStr(b.lastName, "lastName", 200),
    chkStr(b.jobTitle, "jobTitle", 200),
    chkEmail(b.email, "email"),
    chkStr(b.phone, "phone", 50),
    chkStr(b.mobile, "mobile", 50),
    chkStr(b.companyName, "companyName", 200),
    chkStr(b.industry, "industry", 100),
    chkUrl(b.website, "website"),
    chkStr(b.street, "street", 300),
    chkStr(b.city, "city", 100),
    chkStr(b.state, "state", 100),
    chkStr(b.zipCode, "zipCode", 20),
    chkStr(b.country, "country", 100),
    chkEnum(b.status, "status", LEAD_STATUSES),
    chkStr(b.source, "source", 100),
    chkEnum(b.rating, "rating", LEAD_RATINGS),
    chkInt(b.leadScore, "leadScore", 0, 100),
    chkStr(b.notes, "notes", 5000),
    chkBool(b.marketingConsent, "marketingConsent"),
  );

  if (errors.length > 0) return { errors, data: null };

  const emailVal = str(b.email);
  return {
    errors: [],
    data: {
      ...nomeDaRecapito(b),
      jobTitle: str(b.jobTitle),
      email: emailVal ? emailVal.toLowerCase() : null,
      phone: str(b.phone),
      mobile: str(b.mobile),
      companyName: str(b.companyName),
      industry: str(b.industry),
      website: str(b.website),
      street: str(b.street),
      city: str(b.city),
      state: str(b.state),
      zipCode: str(b.zipCode),
      country: str(b.country),
      status: str(b.status) ?? "new",
      source: str(b.source),
      rating: str(b.rating),
      leadScore: b.leadScore != null ? Number(b.leadScore) : null,
      notes: str(b.notes),
      // The ternary that used to be here asked chkBool a question already answered:
      // `chkBool(b.marketingConsent, ...)` is in the checks above, and a failure returns
      // early with `data: null`. Reaching this line meant it had passed, so the false
      // branch could not run. A mutation flipping it to `true` survived, which is how
      // the dead branch was found — a guarantee no test can break is not a guarantee.
      marketingConsent: parseBool(b.marketingConsent),
      tags: parseTags(b.tags),
    },
  };
}

export function buildLeadPayload(data: LeadInput, ownerId: string | null) {
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    jobTitle: data.jobTitle,
    email: data.email,
    phone: data.phone,
    mobile: data.mobile,
    companyName: data.companyName,
    industry: data.industry,
    website: data.website,
    street: data.street,
    city: data.city,
    state: data.state,
    zipCode: data.zipCode,
    country: data.country,
    status: data.status,
    source: data.source ?? "api",
    rating: data.rating,
    leadScore: data.leadScore,
    notes: data.notes,
    marketingConsent: data.marketingConsent,
    tags: data.tags,
    ownerId: ownerId ?? undefined,
  };
}

// ─── Company ──────────────────────────────────────────────────────────────────

export interface CompanyInput {
  name: string;
  industry: string | null;
  website: string | null;
  description: string | null;
  type: string;
  employeeCount: number | null;
  annualRevenue: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  mainPhone: string | null;
  mainEmail: string | null;
  linkedinUrl: string | null;
  source: string | null;
  vatNumber: string | null;
  sdiCode: string | null;
  tags: string[];
}

const COMPANY_TYPES = ["prospect", "customer", "partner", "vendor"] as const;

export function validateCompanyInput(body: unknown): { errors: ValidationError[]; data: CompanyInput | null } {
  if (typeof body !== "object" || body === null) {
    return { errors: [mkErr("body", "Request body must be a JSON object")], data: null };
  }
  const b = body as Record<string, unknown>;

  const errors = collect(
    chkRequired(b.name, "name"),
    chkStr(b.industry, "industry", 100),
    chkUrl(b.website, "website"),
    chkStr(b.description, "description", 2000),
    chkEnum(b.type, "type", COMPANY_TYPES),
    chkInt(b.employeeCount, "employeeCount", 0),
    chkStr(b.annualRevenue, "annualRevenue", 30),
    chkStr(b.street, "street", 300),
    chkStr(b.city, "city", 100),
    chkStr(b.state, "state", 100),
    chkStr(b.zipCode, "zipCode", 20),
    chkStr(b.country, "country", 100),
    chkStr(b.mainPhone, "mainPhone", 50),
    chkEmail(b.mainEmail, "mainEmail"),
    chkUrl(b.linkedinUrl, "linkedinUrl"),
    chkStr(b.source, "source", 100),
    chkStr(b.vatNumber, "vatNumber", 50),
    chkStr(b.sdiCode, "sdiCode", 10),
  );

  if (errors.length > 0) return { errors, data: null };

  const mainEmailVal = str(b.mainEmail);
  return {
    errors: [],
    data: {
      name: (b.name as string).trim(),
      industry: str(b.industry),
      website: str(b.website),
      description: str(b.description),
      type: str(b.type) ?? "prospect",
      employeeCount: b.employeeCount != null ? Number(b.employeeCount) : null,
      annualRevenue: str(b.annualRevenue),
      street: str(b.street),
      city: str(b.city),
      state: str(b.state),
      zipCode: str(b.zipCode),
      country: str(b.country),
      mainPhone: str(b.mainPhone),
      mainEmail: mainEmailVal ? mainEmailVal.toLowerCase() : null,
      linkedinUrl: str(b.linkedinUrl),
      source: str(b.source),
      vatNumber: str(b.vatNumber),
      sdiCode: str(b.sdiCode),
      tags: parseTags(b.tags),
    },
  };
}

export function buildCompanyPayload(data: CompanyInput, ownerId: string | null) {
  return {
    name: data.name,
    industry: data.industry,
    website: data.website,
    description: data.description,
    type: data.type,
    employeeCount: data.employeeCount,
    annualRevenue: data.annualRevenue,
    street: data.street,
    city: data.city,
    state: data.state,
    zipCode: data.zipCode,
    country: data.country,
    mainPhone: data.mainPhone,
    mainEmail: data.mainEmail,
    linkedinUrl: data.linkedinUrl,
    status: "active",
    source: data.source ?? "api",
    vatNumber: data.vatNumber,
    sdiCode: data.sdiCode,
    tags: data.tags,
    ownerId: ownerId ?? undefined,
  };
}

// ─── Contact ──────────────────────────────────────────────────────────────────

export interface ContactInput {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  linkedinUrl: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  source: string | null;
  leadScore: number | null;
  notes: string | null;
  companyId: string | null;
  marketingConsent: boolean;
  tags: string[];
}

export function validateContactInput(body: unknown): { errors: ValidationError[]; data: ContactInput | null } {
  if (typeof body !== "object" || body === null) {
    return { errors: [mkErr("body", "Request body must be a JSON object")], data: null };
  }
  const b = body as Record<string, unknown>;

  const errors = collect(
    chkRequired(b.firstName, "firstName"),
    chkRequired(b.lastName, "lastName"),
    chkStr(b.jobTitle, "jobTitle", 200),
    chkStr(b.department, "department", 100),
    chkEmail(b.email, "email"),
    chkStr(b.phone, "phone", 50),
    chkStr(b.mobile, "mobile", 50),
    chkUrl(b.linkedinUrl, "linkedinUrl"),
    chkStr(b.street, "street", 300),
    chkStr(b.city, "city", 100),
    chkStr(b.state, "state", 100),
    chkStr(b.zipCode, "zipCode", 20),
    chkStr(b.country, "country", 100),
    chkStr(b.source, "source", 100),
    chkInt(b.leadScore, "leadScore", 0, 100),
    chkStr(b.notes, "notes", 5000),
    chkStr(b.companyId, "companyId", 100),
    chkBool(b.marketingConsent, "marketingConsent"),
  );

  if (errors.length > 0) return { errors, data: null };

  const emailVal = str(b.email);
  return {
    errors: [],
    data: {
      firstName: (b.firstName as string).trim(),
      lastName: (b.lastName as string).trim(),
      jobTitle: str(b.jobTitle),
      department: str(b.department),
      email: emailVal ? emailVal.toLowerCase() : null,
      phone: str(b.phone),
      mobile: str(b.mobile),
      linkedinUrl: str(b.linkedinUrl),
      street: str(b.street),
      city: str(b.city),
      state: str(b.state),
      zipCode: str(b.zipCode),
      country: str(b.country),
      source: str(b.source),
      leadScore: b.leadScore != null ? Number(b.leadScore) : null,
      notes: str(b.notes),
      companyId: str(b.companyId),
      // The ternary that used to be here asked chkBool a question already answered:
      // `chkBool(b.marketingConsent, ...)` is in the checks above, and a failure returns
      // early with `data: null`. Reaching this line meant it had passed, so the false
      // branch could not run. A mutation flipping it to `true` survived, which is how
      // the dead branch was found — a guarantee no test can break is not a guarantee.
      marketingConsent: parseBool(b.marketingConsent),
      tags: parseTags(b.tags),
    },
  };
}

export function buildContactPayload(data: ContactInput, ownerId: string | null) {
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    jobTitle: data.jobTitle,
    department: data.department,
    email: data.email,
    phone: data.phone,
    mobile: data.mobile,
    linkedinUrl: data.linkedinUrl,
    street: data.street,
    city: data.city,
    state: data.state,
    zipCode: data.zipCode,
    country: data.country,
    status: "active",
    source: data.source ?? "api",
    leadScore: data.leadScore,
    notes: data.notes,
    companyId: data.companyId,
    marketingConsent: data.marketingConsent,
    tags: data.tags,
    ownerId: ownerId ?? undefined,
  };
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export interface ActivityInput {
  type: string;
  content: string | null;
  date: string | null;
  durationMinutes: number | null;
  participants: string | null;
  leadId: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
}

const ACTIVITY_TYPES = ["note", "call", "meeting", "email"] as const;

export function validateActivityInput(body: unknown): { errors: ValidationError[]; data: ActivityInput | null } {
  if (typeof body !== "object" || body === null) {
    return { errors: [mkErr("body", "Request body must be a JSON object")], data: null };
  }
  const b = body as Record<string, unknown>;

  const errors: ValidationError[] = [];

  const typeReq = chkRequired(b.type, "type");
  if (typeReq) {
    errors.push(typeReq);
  } else {
    const typeEnum = chkEnum(b.type, "type", ACTIVITY_TYPES);
    if (typeEnum) errors.push(typeEnum);
  }

  errors.push(
    ...collect(
      chkStr(b.content, "content", 5000),
      chkInt(b.durationMinutes, "durationMinutes", 0),
      chkStr(b.participants, "participants", 500),
      chkStr(b.leadId, "leadId", 100),
      chkStr(b.contactId, "contactId", 100),
      chkStr(b.companyId, "companyId", 100),
      chkStr(b.dealId, "dealId", 100),
    ),
  );

  if (b.date != null && b.date !== "") {
    if (!isStr(b.date) || Number.isNaN(Date.parse(b.date))) {
      errors.push(mkErr("date", "date must be a valid ISO 8601 date string"));
    }
  }

  const hasEntity = str(b.leadId) || str(b.contactId) || str(b.companyId) || str(b.dealId);
  if (!hasEntity) {
    errors.push(mkErr("entity", "At least one of leadId, contactId, companyId, or dealId is required"));
  }

  if (errors.length > 0) return { errors, data: null };

  return {
    errors: [],
    data: {
      type: (b.type as string).trim(),
      content: str(b.content),
      date: str(b.date),
      durationMinutes: b.durationMinutes != null ? Number(b.durationMinutes) : null,
      participants: str(b.participants),
      leadId: str(b.leadId),
      contactId: str(b.contactId),
      companyId: str(b.companyId),
      dealId: str(b.dealId),
    },
  };
}

export function buildActivityPayload(data: ActivityInput, ownerId: string | null) {
  return {
    type: data.type,
    content: data.content,
    date: data.date ? new Date(data.date) : null,
    durationMinutes: data.durationMinutes,
    participants: data.participants,
    leadId: data.leadId,
    contactId: data.contactId,
    companyId: data.companyId,
    dealId: data.dealId,
    ownerId: ownerId ?? undefined,
  };
}

// ─── Shared ───────────────────────────────────────────────────────────────────

export function parseOnDuplicate(body: Record<string, unknown>): OnDuplicate {
  const v = body.onDuplicate;
  if (v === "update" || v === "error") return v;
  return "skip";
}

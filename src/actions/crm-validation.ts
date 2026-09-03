/**
 * crm-validation.ts — the shape of a lead, a contact and a company.
 *
 * Quotes, tickets and SLAs validated their input with Zod. Leads, contacts and
 * companies — the three most-used entities in the product — took `data: any` and
 * handed it straight to the ORM, so a malformed field reached the user as a raw
 * Postgres error naming a column, instead of a message on the field that was
 * wrong (audit rilievo M-08).
 *
 * Plain module, no `"use server"`: the same schemas are used by the client forms,
 * so a rule cannot be enforced on one side and forgotten on the other.
 */
import { z } from "zod";

/** Empty strings arrive from every uncontrolled input; they mean "not provided". */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .nullable();

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .nullable()
  .refine((v) => v == null || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address.",
  });

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .nullable()
  .refine((v) => v == null || /^https?:\/\/.+/.test(v), {
    message: "Enter a full address, starting with http:// or https://",
  });

/** Accepts an array, or the comma-separated string the tag inputs produce. */
const tagList = z.union([z.array(z.string()), z.string(), z.null(), z.undefined()]).transform((v) => {
  if (Array.isArray(v)) return v.map((t) => t.trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return null;
});

/** A date arrives as an ISO string from a form and as a Date from server code. */
const optionalDate = z.union([z.string(), z.date(), z.null(), z.undefined()]).transform((v) => {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
});

const optionalId = optionalText;

/**
 * For a NOT NULL column that has a database default, such as `status`.
 *
 * Yields `undefined` rather than `null` when empty: "leave it to the default" is a
 * different instruction from "set it to nothing", and the column cannot hold the
 * second one.
 */
const defaultedText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const addressFields = {
  street: optionalText,
  city: optionalText,
  state: optionalText,
  zipCode: optionalText,
  country: optionalText,
};

const ownershipFields = {
  ownerId: optionalId,
  groupId: optionalId,
};

const consentFields = {
  marketingConsent: z.coerce.boolean().default(false),
  consentDate: optionalDate,
};

// ─── Lead ─────────────────────────────────────────────────────────────────────

export const LeadSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  jobTitle: optionalText,
  email: optionalEmail,
  phone: optionalText,
  mobile: optionalText,
  companyName: optionalText,
  industry: optionalText,
  website: optionalUrl,
  ...addressFields,
  status: defaultedText,
  source: optionalText,
  rating: optionalText,
  notes: optionalText,
  ...ownershipFields,
  ...consentFields,
  tags: tagList,
  leadTypeId: optionalId,
  leadCategoryId: optionalId,
});

export const LeadUpdateSchema = LeadSchema.partial().extend({
  firstName: z.string().trim().min(1, "First name is required.").optional(),
  lastName: z.string().trim().min(1, "Last name is required.").optional(),
});

// ─── Contact ──────────────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  jobTitle: optionalText,
  department: optionalText,
  email: optionalEmail,
  phone: optionalText,
  mobile: optionalText,
  linkedinUrl: optionalUrl,
  ...addressFields,
  status: defaultedText,
  source: optionalText,
  notes: optionalText,
  companyId: optionalId,
  ...ownershipFields,
  ...consentFields,
  tags: tagList,
});

export const ContactUpdateSchema = ContactSchema.partial().extend({
  firstName: z.string().trim().min(1, "First name is required.").optional(),
  lastName: z.string().trim().min(1, "Last name is required.").optional(),
});

// ─── Company ──────────────────────────────────────────────────────────────────

export const CompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required."),
  industry: optionalText,
  website: optionalUrl,
  description: optionalText,
  type: defaultedText,
  employeeCount: z.coerce.number().int().min(0).optional().nullable(),
  // Drizzle maps `numeric` to a string, because a float cannot hold money without
  // losing cents. The form sends a number; it is converted here rather than at the
  // three call sites that would each have to remember.
  annualRevenue: z
    .union([z.coerce.number().min(0), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v === "" || v == null ? null : String(v))),
  ...addressFields,
  mainPhone: optionalText,
  mainEmail: optionalEmail,
  linkedinUrl: optionalUrl,
  status: defaultedText,
  source: optionalText,
  ...ownershipFields,
  vatNumber: optionalText,
  sdiCode: optionalText,
  tags: tagList,
  companyCategoryId: optionalId,
  companyTypeId: optionalId,
});

export const CompanyUpdateSchema = CompanySchema.partial().extend({
  name: z.string().trim().min(1, "Company name is required.").optional(),
});

export type LeadInput = z.input<typeof LeadSchema>;
export type ContactInput = z.input<typeof ContactSchema>;
export type CompanyInput = z.input<typeof CompanySchema>;

/**
 * Drops the keys a schema turned into `undefined`, so a partial update does not
 * blank a column the form never showed.
 */
export function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

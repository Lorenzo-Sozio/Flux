import { boolean, integer, numeric, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  password: text("password"),
  role: text("role").default("user").notNull(),
});

// ─── User Groups ──────────────────────────────────────────────────────────────

export const userGroups = pgTable("user_group", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").default("#6366f1").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const userGroupMembers = pgTable(
  "user_group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => userGroups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }),
);

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

// ─── GEO REFERENCE TABLES ─────────────────────────────────────────────────────

export const geoCountries = pgTable(
  "geo_country",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    iso2: text("iso2").notNull(),
    iso3: text("iso3"),
    nameEn: text("name_en").notNull(),
    nameIt: text("name_it"),
    callingCode: text("calling_code"),
    active: boolean("active").default(true).notNull(),
  },
  (t) => [unique("geo_country_iso2_uniq").on(t.iso2)],
);

export const geoCities = pgTable(
  "geo_city",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    countryId: text("country_id")
      .notNull()
      .references(() => geoCountries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    region: text("region"),
    postalCodes: text("postal_codes").array().default([]),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("geo_city_country_slug_uniq").on(t.countryId, t.slug)],
);

// --- CRM LOOKUP TABLES ---

export const companyCategories = pgTable("company_category", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const companyTypes = pgTable("company_type", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- CRM CORE ENTITIES ---

export const companies = pgTable("company", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  industry: text("industry"),
  website: text("website"),
  description: text("description"),
  type: text("type").default("prospect"), // prospect, customer, partner, vendor
  employeeCount: integer("employee_count"),
  annualRevenue: numeric("annual_revenue", { precision: 15, scale: 2 }),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  country: text("country"),
  mainPhone: text("main_phone"),
  mainEmail: text("main_email"),
  linkedinUrl: text("linkedin_url"),
  status: text("status").default("active").notNull(),
  source: text("source"),
  leadScore: integer("lead_score"),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  groupId: text("group_id").references(() => userGroups.id, { onDelete: "set null" }),
  vatNumber: text("vat_number"),
  sdiCode: text("sdi_code"),
  tags: text("tags").array(),
  sourceLeadId: text("source_lead_id"), // FK set via migration → lead.id (set null)
  companyCategoryId: text("company_category_id").references(() => companyCategories.id, { onDelete: "set null" }),
  companyTypeId: text("company_type_id").references(() => companyTypes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const leads = pgTable("lead", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  jobTitle: text("job_title"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  companyName: text("company_name"),
  industry: text("industry"),
  website: text("website"),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  country: text("country"),
  status: text("status").default("new").notNull(), // new, contacting, engaged, qualified, unqualified
  source: text("source"), // organic, referral, outbound, event, etc.
  rating: text("rating"), // hot, warm, cold
  leadScore: integer("lead_score"),
  notes: text("notes"),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  groupId: text("group_id").references(() => userGroups.id, { onDelete: "set null" }),
  marketingConsent: boolean("marketing_consent").default(false),
  consentDate: timestamp("consent_date", { mode: "date" }),
  tags: text("tags").array(),
  leadTypeId: text("lead_type_id").references(() => companyTypes.id, { onDelete: "set null" }),
  leadCategoryId: text("lead_category_id").references(() => companyCategories.id, { onDelete: "set null" }),
  isConverted: boolean("is_converted").default(false).notNull(),
  convertedAt: timestamp("converted_at", { mode: "date" }),
  convertedToContactId: text("converted_to_contact_id"), // FK set via migration → contact.id (set null)
  convertedToCompanyId: text("converted_to_company_id"), // FK set via migration → company.id (set null)
  convertedToDealId: text("converted_to_deal_id"), // FK set via migration → deal.id (set null)
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const contacts = pgTable("contact", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  jobTitle: text("job_title"),
  department: text("department"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  linkedinUrl: text("linkedin_url"),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  country: text("country"),
  status: text("status").default("active").notNull(),
  source: text("source"),
  leadScore: integer("lead_score"),
  notes: text("notes"),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  groupId: text("group_id").references(() => userGroups.id, { onDelete: "set null" }),
  marketingConsent: boolean("marketing_consent").default(false),
  consentDate: timestamp("consent_date", { mode: "date" }),
  tags: text("tags").array(),
  sourceLeadId: text("source_lead_id"), // FK set via migration → lead.id (set null)
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const opportunities = pgTable("opportunity", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  stage: text("stage").default("prospecting").notNull(), // prospecting, qualification, proposal, negotiation, closed_won, closed_lost
  probability: integer("probability"), // 0-100
  expectedCloseDate: timestamp("expected_close_date", { mode: "date" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const products = pgTable("product", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  sku: text("sku"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0"),
  unit: text("unit"),
  category: text("category"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const orders = pgTable("order", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orderNumber: text("order_number").notNull().unique(),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  // An order used to carry a single tax-free number and no currency at all, so the
  // same content quoted and ordered showed two different totals (rilievo C-04).
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0").notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").default("EUR").notNull(),
  // Where the order came from. `opportunityId` pointed at a table nothing reads,
  // so an order could not be traced to the quote or deal that produced it
  // (rilievi D-06, S-03).
  quoteId: text("quote_id"), // FK set via migration → quote.id (set null)
  dealId: text("deal_id"), // FK set via migration → deal.id (set null)
  status: text("status").default("draft").notNull(), // draft, processing, completed, cancelled
  orderDate: timestamp("order_date", { mode: "date" }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const orderItems = pgTable("order_item", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
});

import { relations } from "drizzle-orm";

export const pipelineStages = pgTable("pipeline_stage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  color: text("color"),
  defaultProbability: integer("default_probability").default(0),
  // Terminal stages. Without these, dragging a card into the "Won" column changed
  // the stage and left `deal.status` at "open" forever, so the deal kept weighing
  // on the forecast (audit rilievo C-06).
  isWon: boolean("is_won").default(false).notNull(),
  isLost: boolean("is_lost").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const deals = pgTable("deal", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  currency: text("currency").default("EUR").notNull(),
  probability: integer("probability").default(0),
  expectedCloseDate: timestamp("expected_close_date", { mode: "date" }),
  stageId: text("stage_id").references(() => pipelineStages.id, { onDelete: "restrict" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  groupId: text("group_id").references(() => userGroups.id, { onDelete: "set null" }),
  status: text("status").default("open").notNull(), // open, won, lost
  // "Won this month" was computed from updatedAt, so re-saving an old deal moved
  // it into the current month's revenue (audit rilievo C-07).
  closedAt: timestamp("closed_at", { mode: "date" }),
  // Without a reason there is no win/loss analysis at all — the product knew how
  // much was lost and never why.
  lostReason: text("lost_reason"),
  healthScore: integer("health_score").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const pipelineStagesRelations = relations(pipelineStages, ({ many }) => ({
  deals: many(deals),
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  stage: one(pipelineStages, {
    fields: [deals.stageId],
    references: [pipelineStages.id],
  }),
  company: one(companies, {
    fields: [deals.companyId],
    references: [companies.id],
  }),
  contact: one(contacts, {
    fields: [deals.contactId],
    references: [contacts.id],
  }),
  owner: one(users, {
    fields: [deals.ownerId],
    references: [users.id],
  }),
}));

export const activities = pgTable("activity", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: text("type").notNull(), // note, call, meeting, email
  content: text("content"),
  date: timestamp("date", { mode: "date" }),
  durationMinutes: integer("duration_minutes"), // call/meeting duration
  reminderMinutes: integer("reminder_minutes"), // minutes before date to remind (null = off)
  participants: text("participants"), // comma-separated names/emails for meetings
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const tasks = pgTable("task", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { mode: "date" }),
  startDate: timestamp("start_date", { mode: "date" }),
  allDay: boolean("all_day").default(true).notNull(),
  status: text("status").default("todo").notNull(), // todo, in_progress, done
  priority: text("priority").default("normal").notNull(), // low, normal, high, critical, blocker
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  parentId: text("parent_id"), // self-reference, set FK via migration
  depth: integer("depth").default(0).notNull(), // 0=root, 1=subtask, 2=sub-subtask, 3=leaf max
  progressPct: integer("progress_pct").default(0).notNull(), // 0-100, auto-calculated from children
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  estimatedHours: numeric("estimated_hours", { precision: 5, scale: 2 }),
  actualHours: numeric("actual_hours", { precision: 5, scale: 2 }).default("0"),
  ticketId: text("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const taskTimeLogs = pgTable("task_time_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { mode: "date" }).notNull(),
  stoppedAt: timestamp("stopped_at", { mode: "date" }),
  hours: numeric("hours", { precision: 5, scale: 2 }),
  note: text("note"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const taskAssignees = pgTable("task_assignee", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("responsible"), // responsible | accountable | consulted | informed
});

export const taskDependencies = pgTable("task_dependency", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  predecessorId: text("predecessor_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  successorId: text("successor_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("FS"), // FS | SS | FF | SF
  lagDays: integer("lag_days").default(0).notNull(),
});

export const emailTemplates = pgTable("email_template", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // HTML content
  isHtml: boolean("is_html").default(true).notNull(), // true = HTML, false = plain text
  category: text("category").default("general").notNull(), // general, welcome, followup, promotional, transactional
  previewText: text("preview_text"), // Short preview of email (for email clients)
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  isPublic: boolean("is_public").default(false), // Share with team
  tags: text("tags").array().default([]), // e.g., ["sales", "onboarding", "q2-2026"]
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const marketingCampaigns = pgTable("marketing_campaign", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").default("draft").notNull(), // draft, scheduled, active, completed
  templateId: text("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at", { mode: "date" }),
  recipientType: text("recipient_type"), // contacts | leads — stored when scheduling
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const campaignLogs = pgTable("campaign_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").references(() => marketingCampaigns.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  status: text("status").default("queued").notNull(), // queued, sent, opened, clicked, bounced, complained, failed, unsubscribed
  openedAt: timestamp("opened_at", { mode: "date" }),
  clickedAt: timestamp("clicked_at", { mode: "date" }),
  errorMessage: text("error_message"),
  messageId: text("message_id"), // provider message ID (for webhook correlation)
});

// --- EMAIL SETTINGS ---
export const emailSettings = pgTable("email_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  provider: text("provider").notNull().default("resend"), // resend | smtp
  resendApiKey: text("resend_api_key"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(587),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpSecure: boolean("smtp_secure").default(false),
  fromEmail: text("from_email").notNull().default("noreply@yourdomain.com"),
  fromName: text("from_name").notNull().default("CRM"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- EMAIL QUEUE ---
export const emailJobs = pgTable("email_job", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").references(() => marketingCampaigns.id, { onDelete: "cascade" }),
  campaignLogId: text("campaign_log_id").references(() => campaignLogs.id, { onDelete: "cascade" }),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(), // fully rendered HTML (personalised + tracking)
  status: text("status").notNull().default("pending"), // pending, processing, sent, failed, cancelled
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  scheduledAt: timestamp("scheduled_at", { mode: "date" }).defaultNow(),
  processedAt: timestamp("processed_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- EMAIL SUPPRESSIONS (unsubscribes + bounces) ---
export const emailSuppressions = pgTable("email_suppression", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  reason: text("reason").notNull().default("unsubscribe"), // unsubscribe | bounce_hard | bounce_soft | complaint
  campaignId: text("campaign_id"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- CUSTOM FILTERS ---
export const customFilters = pgTable("custom_filter", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  entityType: text("entity_type").notNull(), // leads, contacts, companies, deals, activities, tasks
  ownerId: text("owner_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  criteria: text("criteria").notNull(), // JSON stringified array of filter conditions
  isPublic: boolean("is_public").default(false), // true = shared with team
  isPinned: boolean("is_pinned").default(false), // true = shows in quick access
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const customFilterTags = pgTable("custom_filter_tag", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  filterId: text("filter_id")
    .references(() => customFilters.id, { onDelete: "cascade" })
    .notNull(),
  tag: text("tag").notNull(), // e.g., "sales", "high-priority", "q2-2026"
});

export const filterPresets = pgTable("filter_preset", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  entityType: text("entity_type").notNull(), // leads, contacts, etc.
  defaultCriteria: text("default_criteria").notNull(), // JSON - predefined filter conditions
  isSystem: boolean("is_system").default(false), // true = built-in system presets
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const activitiesRelations = relations(activities, ({ one }) => ({
  owner: one(users, { fields: [activities.ownerId], references: [users.id] }),
  lead: one(leads, { fields: [activities.leadId], references: [leads.id] }),
  contact: one(contacts, { fields: [activities.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [activities.companyId], references: [companies.id] }),
  deal: one(deals, { fields: [activities.dealId], references: [deals.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  owner: one(users, { fields: [tasks.ownerId], references: [users.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [tasks.companyId], references: [companies.id] }),
  deal: one(deals, { fields: [tasks.dealId], references: [deals.id] }),
  ticket: one(tickets, { fields: [tasks.ticketId], references: [tickets.id] }),
  parent: one(tasks, { fields: [tasks.parentId], references: [tasks.id], relationName: "subtasks" }),
  subtasks: many(tasks, { relationName: "subtasks" }),
  assignees: many(taskAssignees),
  timeLogs: many(taskTimeLogs),
  predecessorDeps: many(taskDependencies, { relationName: "successors" }),
  successorDeps: many(taskDependencies, { relationName: "predecessors" }),
}));

export const taskDependenciesRelations = relations(taskDependencies, ({ one }) => ({
  predecessor: one(tasks, {
    fields: [taskDependencies.predecessorId],
    references: [tasks.id],
    relationName: "successors",
  }),
  successor: one(tasks, {
    fields: [taskDependencies.successorId],
    references: [tasks.id],
    relationName: "predecessors",
  }),
}));

export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, { fields: [taskAssignees.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskAssignees.userId], references: [users.id] }),
}));

export const taskTimeLogsRelations = relations(taskTimeLogs, ({ one }) => ({
  task: one(tasks, { fields: [taskTimeLogs.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskTimeLogs.userId], references: [users.id] }),
}));

export const emailTemplatesRelations = relations(emailTemplates, ({ one, many }) => ({
  owner: one(users, { fields: [emailTemplates.ownerId], references: [users.id] }),
  campaigns: many(marketingCampaigns),
}));

export const marketingCampaignsRelations = relations(marketingCampaigns, ({ one, many }) => ({
  owner: one(users, { fields: [marketingCampaigns.ownerId], references: [users.id] }),
  template: one(emailTemplates, { fields: [marketingCampaigns.templateId], references: [emailTemplates.id] }),
  logs: many(campaignLogs),
}));

export const campaignLogsRelations = relations(campaignLogs, ({ one }) => ({
  campaign: one(marketingCampaigns, { fields: [campaignLogs.campaignId], references: [marketingCampaigns.id] }),
  lead: one(leads, { fields: [campaignLogs.leadId], references: [leads.id] }),
  contact: one(contacts, { fields: [campaignLogs.contactId], references: [contacts.id] }),
}));

export const leadsRelations = relations(leads, ({ many }) => ({
  activities: many(activities),
  tasks: many(tasks),
  campaignLogs: many(campaignLogs),
}));

export const contactsRelations = relations(contacts, ({ many, one }) => ({
  activities: many(activities),
  tasks: many(tasks),
  campaignLogs: many(campaignLogs),
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
}));

export const customFiltersRelations = relations(customFilters, ({ one, many }) => ({
  owner: one(users, { fields: [customFilters.ownerId], references: [users.id] }),
  tags: many(customFilterTags),
}));

export const customFilterTagsRelations = relations(customFilterTags, ({ one }) => ({
  filter: one(customFilters, { fields: [customFilterTags.filterId], references: [customFilters.id] }),
}));

// --- PASSWORD RESET TOKENS ---
export const passwordResetTokens = pgTable(
  "password_reset_token",
  {
    identifier: text("identifier").notNull(), // user email
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => ({ compoundKey: primaryKey({ columns: [t.identifier, t.token] }) }),
);

// --- USER INVITATIONS ---
export const userInvitations = pgTable("user_invitation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role").default("user").notNull(), // owner, admin, user, viewer
  invitedById: text("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  // Tenant-scoped invitation: when set, user is auto-provisioned as tenant member on accept
  tenantId: text("tenant_id"), // FK to tenants.id — enforced at app level (avoids forward-ref)
  tenantRole: text("tenant_role").default("editor"),
});

// --- IN-APP NOTIFICATIONS ---
export const notifications = pgTable("notification", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // task_due, deal_won, lead_assigned, email_sent, system
  title: text("title").notNull(),
  message: text("message"),
  link: text("link"), // /dashboard/tasks/123
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- CUSTOM FIELD DEFINITIONS ---
export const customFieldDefinitions = pgTable("custom_field_definition", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(), // e.g. "LinkedIn URL"
  slug: text("slug").notNull(), // e.g. "linkedin_url"
  entityType: text("entity_type").notNull(), // contact, lead, company, deal
  fieldType: text("field_type").notNull(), // text, number, date, select, multiselect, boolean, url
  options: text("options"), // JSON array for select/multiselect options
  isRequired: boolean("is_required").default(false).notNull(),
  order: integer("order").default(0).notNull(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- CUSTOM FIELD VALUES ---
export const customFieldValues = pgTable("custom_field_value", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  fieldId: text("field_id")
    .notNull()
    .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // contact, lead, company, deal
  entityId: text("entity_id").notNull(),
  value: text("value"), // stored as text, cast on read based on fieldType
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- DOCUMENTS / ATTACHMENTS ---
export const documents = pgTable("document", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  url: text("url").notNull(), // S3/Uploadthing URL
  mimeType: text("mime_type"),
  size: integer("size"), // bytes
  version: integer("version").default(1).notNull(),
  entityType: text("entity_type"), // contact, deal, lead, company, quote
  entityId: text("entity_id"),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- QUOTES & PROPOSALS ---
export const quotes = pgTable("quote", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  quoteNumber: text("quote_number").notNull().unique(),
  dealId: text("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").default("draft").notNull(), // draft, pending_approval, sent, viewed, accepted, declined, expired, converted
  approvalNote: text("approval_note"),
  approvedById: text("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { mode: "date" }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  // The currency the document is written in — what the customer reads. Amounts
  // above are stored in it. Previously every quote was rewritten into EUR and this
  // column hardcoded to "EUR", so an offer made in dollars reached the customer as
  // a euro figure at the day's rate (audit rilievo C-02).
  currency: text("currency").default("EUR").notNull(),
  // The rate used to express this document in EUR for reporting, captured at issue
  // time so a later rate change cannot rewrite history.
  eurRate: numeric("eur_rate", { precision: 18, scale: 8 }).default("1"),
  issuedAt: timestamp("issued_at", { mode: "date" }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }),
  sentAt: timestamp("sent_at", { mode: "date" }),
  viewedAt: timestamp("viewed_at", { mode: "date" }),
  acceptedAt: timestamp("accepted_at", { mode: "date" }),
  declinedAt: timestamp("declined_at", { mode: "date" }),
  declineReason: text("decline_reason"),
  version: integer("version").default(1).notNull(),
  notes: text("notes"),
  publicToken: text("public_token")
    .unique()
    .$defaultFn(() => crypto.randomUUID()),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const quoteItems = pgTable("quote_item", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  quoteId: text("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
});

export const quoteActivities = pgTable("quote_activity", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  quoteId: text("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // sent, viewed, opened_email, clicked_email, accepted, declined, reminded, created, updated
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- SUPPORT TICKETS & CASES (Omnichannel) ---
export const tickets = pgTable("ticket", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ticketNumber: text("ticket_number").notNull().unique(),
  subject: text("subject").notNull(),
  description: text("description"),
  channel: text("channel").notNull(), // email, chat, phone, social
  priority: text("priority").default("normal").notNull(), // low, normal, high, urgent
  severity: text("severity").default("normal").notNull(), // low, normal, high, critical
  status: text("status").default("new").notNull(), // new, open, in_progress, waiting, on_hold, resolved, closed
  type: text("type").default("support"), // support, bug, complaint, info_request, internal_task
  component: text("component"),
  groupId: text("group_id").references(() => userGroups.id, { onDelete: "set null" }),
  parentTicketId: text("parent_ticket_id"),
  slaDeadlineAt: timestamp("sla_deadline_at", { mode: "date" }),
  // An SLA defines two promises and the ticket only ever tracked one of them, so
  // first-response compliance was unmeasurable (audit rilievo D-01).
  firstResponseDueAt: timestamp("first_response_due_at", { mode: "date" }),
  firstResponseBreachedAt: timestamp("first_response_breached_at", { mode: "date" }),
  slaPausedAt: timestamp("sla_paused_at", { mode: "date" }),
  slaPauseMinutes: integer("sla_pause_minutes").default(0).notNull(),
  slaBreachedAt: timestamp("sla_breached_at", { mode: "date" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  slaId: text("sla_id").references(() => slas.id, { onDelete: "set null" }),
  firstResponseAt: timestamp("first_response_at", { mode: "date" }),
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
  closedAt: timestamp("closed_at", { mode: "date" }),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const ticketMessages = pgTable("ticket_message", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  senderId: text("sender_id").references(() => users.id, { onDelete: "set null" }),
  senderEmail: text("sender_email"),
  senderName: text("sender_name"),
  channel: text("channel").notNull(), // email, chat, phone, social
  content: text("content").notNull(),
  isPublic: boolean("is_public").default(true).notNull(),
  attachmentIds: text("attachment_ids").array().default([]), // document IDs
  emailMessageId: text("email_message_id"),
  emailInReplyTo: text("email_in_reply_to"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const slas = pgTable("sla", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  priority: text("priority").notNull(), // low, normal, high, urgent
  firstResponseTimeMinutes: integer("first_response_time_minutes").notNull(),
  resolutionTimeMinutes: integer("resolution_time_minutes").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const chatChannels = pgTable("chat_channel", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  type: text("type").notNull(), // live_chat, whatsapp, telegram, slack
  isActive: boolean("is_active").default(true).notNull(),
  config: text("config"), // JSON: API keys, webhook URLs, etc.
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const chatSessions = pgTable("chat_session", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ticketId: text("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  channelId: text("channel_id").references(() => chatChannels.id),
  visitorId: text("visitor_id"),
  visitorEmail: text("visitor_email"),
  visitorName: text("visitor_name"),
  status: text("status").default("active").notNull(), // active, waiting, assigned, closed
  assignedAgentId: text("assigned_agent_id").references(() => users.id),
  startedAt: timestamp("started_at", { mode: "date" }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const ticketAuditLogs = pgTable("ticket_audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references(() => users.id),
  actorName: text("actor_name"),
  action: text("action").notNull(), // status_changed | priority_changed | assigned | message_added | created | field_changed
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const ticketMacros = pgTable("ticket_macro", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  body: text("body").notNull(),
  isPublic: boolean("is_public").default(true).notNull(),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- WEBHOOKS ---
export const webhooks = pgTable("webhook", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: text("events").array().notNull(), // ["contact.created", "deal.won", ...]
  secret: text("secret"), // for HMAC signature verification
  isActive: boolean("is_active").default(true).notNull(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  webhookId: text("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: text("payload"), // JSON
  statusCode: integer("status_code"),
  response: text("response"),
  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  success: boolean("success").default(false).notNull(),
});

// Relations for new tables
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const userInvitationsRelations = relations(userInvitations, ({ one }) => ({
  invitedBy: one(users, { fields: [userInvitations.invitedById], references: [users.id] }),
}));

export const customFieldDefinitionsRelations = relations(customFieldDefinitions, ({ many }) => ({
  values: many(customFieldValues),
}));

export const customFieldValuesRelations = relations(customFieldValues, ({ one }) => ({
  field: one(customFieldDefinitions, { fields: [customFieldValues.fieldId], references: [customFieldDefinitions.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ many }) => ({
  logs: many(webhookLogs),
}));

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookLogs.webhookId], references: [webhooks.id] }),
}));

// --- QUOTE RELATIONS ---
export const quotesRelations = relations(quotes, ({ one, many }) => ({
  deal: one(deals, { fields: [quotes.dealId], references: [deals.id] }),
  company: one(companies, { fields: [quotes.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [quotes.contactId], references: [contacts.id] }),
  owner: one(users, { fields: [quotes.ownerId], references: [users.id] }),
  items: many(quoteItems),
  activities: many(quoteActivities),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  product: one(products, { fields: [quoteItems.productId], references: [products.id] }),
}));

export const quoteActivitiesRelations = relations(quoteActivities, ({ one }) => ({
  quote: one(quotes, { fields: [quoteActivities.quoteId], references: [quotes.id] }),
  user: one(users, { fields: [quoteActivities.userId], references: [users.id] }),
}));

// --- SUPPORT/TICKET RELATIONS ---
export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  contact: one(contacts, { fields: [tickets.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [tickets.companyId], references: [companies.id] }),
  lead: one(leads, { fields: [tickets.leadId], references: [leads.id] }),
  assignee: one(users, { fields: [tickets.assigneeId], references: [users.id] }),
  owner: one(users, { fields: [tickets.ownerId], references: [users.id] }),
  sla: one(slas, { fields: [tickets.slaId], references: [slas.id] }),
  group: one(userGroups, { fields: [tickets.groupId], references: [userGroups.id] }),
  messages: many(ticketMessages),
  auditLogs: many(ticketAuditLogs),
  tasks: many(tasks),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketMessages.ticketId], references: [tickets.id] }),
  sender: one(users, { fields: [ticketMessages.senderId], references: [users.id] }),
}));

export const ticketAuditLogsRelations = relations(ticketAuditLogs, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketAuditLogs.ticketId], references: [tickets.id] }),
  actor: one(users, { fields: [ticketAuditLogs.actorId], references: [users.id] }),
}));

export const ticketMacrosRelations = relations(ticketMacros, ({ one }) => ({
  creator: one(users, { fields: [ticketMacros.createdBy], references: [users.id] }),
}));

export const slasRelations = relations(slas, ({ many }) => ({
  tickets: many(tickets),
}));

export const chatChannelsRelations = relations(chatChannels, ({ many }) => ({
  sessions: many(chatSessions),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one }) => ({
  ticket: one(tickets, { fields: [chatSessions.ticketId], references: [tickets.id] }),
  channel: one(chatChannels, { fields: [chatSessions.channelId], references: [chatChannels.id] }),
  assignedAgent: one(users, { fields: [chatSessions.assignedAgentId], references: [users.id] }),
}));

// --- AUTOMATION RULES ---
export const automationRules = pgTable("automation_rule", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  targetEntity: text("target_entity").notNull(), // "deal" | "lead" | "contact" | "company"
  triggerOn: text("trigger_on").array().notNull(), // ["onCreate", "onUpdate"]
  conditionLogic: text("condition_logic").default("AND").notNull(), // "AND" | "OR" (deprecated, use conditionExpression)
  conditions: text("conditions").notNull(), // JSON: Condition[]
  // NEW: Espressione logica avanzata (es: "(C0 OR C1) AND C2")
  conditionExpression: text("condition_expression"), // Advanced logic with parentheses
  actions: text("actions").notNull(), // JSON: AutomationAction[]
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const automationLogs = pgTable("automation_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ruleId: text("rule_id")
    .notNull()
    .references(() => automationRules.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  event: text("event").notNull(), // "onCreate" | "onUpdate" | "onSLABreach"
  success: boolean("success").notNull(),
  actionsExecuted: integer("actions_executed").default(0).notNull(),
  errorMessage: text("error_message"),
  loopDetected: boolean("loop_detected").default(false).notNull(),
  loopInfo: text("loop_info"), // JSON: { triggeredRules: string[], depth: number, chain: string[] }
  retryCount: integer("retry_count").default(0).notNull(),
  retryInfo: text("retry_info"), // JSON: { attempts: number, maxAttempts: number, lastError: string, exponentialBackoff: boolean }
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- USER ACTIVITY LOG (audit trail for reports) ---
export const userActivityLogs = pgTable("user_activity_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // e.g. "login", "create_deal", "complete_task", "send_campaign"
  entityType: text("entity_type"), // "deal" | "contact" | "lead" | "task" | "quote" | "ticket" | "campaign"
  entityId: text("entity_id"),
  metadata: text("metadata"), // JSON string for extra context
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const userActivityLogsRelations = relations(userActivityLogs, ({ one }) => ({
  user: one(users, { fields: [userActivityLogs.userId], references: [users.id] }),
}));

export const automationRulesRelations = relations(automationRules, ({ one, many }) => ({
  owner: one(users, { fields: [automationRules.ownerId], references: [users.id] }),
  logs: many(automationLogs),
}));

export const automationLogsRelations = relations(automationLogs, ({ one }) => ({
  rule: one(automationRules, { fields: [automationLogs.ruleId], references: [automationRules.id] }),
}));

// ─── User Groups relations ────────────────────────────────────────────────────

export const userGroupsRelations = relations(userGroups, ({ many }) => ({
  members: many(userGroupMembers),
}));

export const userGroupMembersRelations = relations(userGroupMembers, ({ one }) => ({
  group: one(userGroups, { fields: [userGroupMembers.groupId], references: [userGroups.id] }),
  user: one(users, { fields: [userGroupMembers.userId], references: [users.id] }),
}));

// ─── Internal DM / Group Chat ─────────────────────────────────────────────────

export const dmConversations = pgTable("dm_conversation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: text("type").notNull(), // "direct" | "group"
  name: text("name"), // only for group conversations
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const dmConversationMembers = pgTable("dm_conversation_member", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => dmConversations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at", { mode: "date" }),
  mutedUntil: timestamp("muted_until", { mode: "date" }), // null = not muted
  joinedAt: timestamp("joined_at", { mode: "date" }).defaultNow().notNull(),
});

export const dmMessages = pgTable("dm_message", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => dmConversations.id, { onDelete: "cascade" }),
  senderId: text("sender_id").references(() => users.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── DM relations ─────────────────────────────────────────────────────────────

export const dmConversationsRelations = relations(dmConversations, ({ many }) => ({
  members: many(dmConversationMembers),
  messages: many(dmMessages),
}));

export const dmConversationMembersRelations = relations(dmConversationMembers, ({ one }) => ({
  conversation: one(dmConversations, {
    fields: [dmConversationMembers.conversationId],
    references: [dmConversations.id],
  }),
  user: one(users, { fields: [dmConversationMembers.userId], references: [users.id] }),
}));

export const dmMessagesRelations = relations(dmMessages, ({ one }) => ({
  conversation: one(dmConversations, { fields: [dmMessages.conversationId], references: [dmConversations.id] }),
  sender: one(users, { fields: [dmMessages.senderId], references: [users.id] }),
}));

// ─── Appointments ─────────────────────────────────────────────────────────────

export const appointments = pgTable("appointment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  startAt: timestamp("start_at", { mode: "date" }).notNull(),
  endAt: timestamp("end_at", { mode: "date" }).notNull(),
  timezone: text("timezone").default("UTC").notNull(),
  location: text("location"),
  locationUrl: text("location_url"),
  conferenceType: text("conference_type"), // 'jitsi' | 'zoom' | 'teams' | 'custom'
  conferenceLink: text("conference_link"),
  status: text("status").default("scheduled").notNull(), // scheduled, cancelled, completed
  icalUid: text("ical_uid").notNull().unique(),
  sequence: integer("sequence").default(0).notNull(),
  organizerId: text("organizer_id").references(() => users.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  dealId: text("deal_id").references(() => deals.id, { onDelete: "set null" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  reminderMinutes: integer("reminder_minutes"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const appointmentAttendees = pgTable("appointment_attendee", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  appointmentId: text("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").default("required").notNull(), // organizer, required, optional
  status: text("status").default("pending").notNull(), // pending, accepted, declined, tentative
  responseAt: timestamp("response_at", { mode: "date" }),
  responseToken: text("response_token").unique(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  organizer: one(users, { fields: [appointments.organizerId], references: [users.id] }),
  contact: one(contacts, { fields: [appointments.contactId], references: [contacts.id] }),
  deal: one(deals, { fields: [appointments.dealId], references: [deals.id] }),
  company: one(companies, { fields: [appointments.companyId], references: [companies.id] }),
  lead: one(leads, { fields: [appointments.leadId], references: [leads.id] }),
  attendees: many(appointmentAttendees),
}));

export const appointmentAttendeesRelations = relations(appointmentAttendees, ({ one }) => ({
  appointment: one(appointments, {
    fields: [appointmentAttendees.appointmentId],
    references: [appointments.id],
  }),
  user: one(users, { fields: [appointmentAttendees.userId], references: [users.id] }),
  contact: one(contacts, { fields: [appointmentAttendees.contactId], references: [contacts.id] }),
}));

// ── Sales Targets ─────────────────────────────────────────────────────────────

export const salesTargets = pgTable(
  "sales_target",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    period: text("period").notNull(), // "2026-05" | "2026-Q2" | "2026"
    periodType: text("period_type").notNull().default("month"), // month | quarter | year
    targetAmount: numeric("target_amount", { precision: 12, scale: 2 }).notNull(),
    targetDeals: integer("target_deals"),
    currency: text("currency").default("EUR").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("sales_target_user_period_unique").on(t.userId, t.period)],
);

export const salesTargetsRelations = relations(salesTargets, ({ one }) => ({
  user: one(users, { fields: [salesTargets.userId], references: [users.id] }),
}));

// ── Deal Comments ─────────────────────────────────────────────────────────────

export const dealComments = pgTable("deal_comment", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  dealId: text("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  parentId: text("parent_id"), // FK added via migration → deal_comment.id (set null)
  editedAt: timestamp("edited_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const dealCommentsRelations = relations(dealComments, ({ one, many }) => ({
  deal: one(deals, { fields: [dealComments.dealId], references: [deals.id] }),
  user: one(users, { fields: [dealComments.userId], references: [users.id] }),
  parent: one(dealComments, {
    fields: [dealComments.parentId],
    references: [dealComments.id],
    relationName: "replies",
  }),
  replies: many(dealComments, { relationName: "replies" }),
}));

// ── Saved Reports ──────────────────────────────────────────────────────────────

export const savedReports = pgTable("saved_report", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  config: text("config").notNull(), // JSON-serialised ReportConfig
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  isPublic: boolean("is_public").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const savedReportsRelations = relations(savedReports, ({ one }) => ({
  owner: one(users, { fields: [savedReports.ownerId], references: [users.id] }),
}));

// ─── Exchange Rates Cache ─────────────────────────────────────────────────────

export const exchangeRatesCache = pgTable("exchange_rates_cache", {
  id: text("id").primaryKey().default("eur"),
  rates: text("rates").notNull(), // JSON: { usd: 1.09, gbp: 0.86, ... }
  fetchedAt: timestamp("fetched_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Multi-tenant registry (platform DB) ──────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  dbUrl: text("db_url").notNull(), // AES-256-GCM encrypted Neon connection string
  settings: text("settings"), // JSON: { emoji?, logo?, primaryColor? }
  // SHA-256 of this tenant's own API key. The key itself is never stored: it is
  // shown once when minted and cannot be recovered.
  //
  // Before this column there was a single global IMPORT_API_KEY, and whoever held it
  // could write into ANY tenant's database by changing the X-Tenant-ID header — the
  // header was only checked for existence, never bound to the caller. A per-tenant key
  // makes the tenant a property of the credential instead of a claim of the request.
  apiKeyHash: text("api_key_hash").unique(),
  lastMigratedAt: timestamp("last_migrated_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// Maps platform users to tenants with a role. Lives only in the platform DB.
export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Mirrors the roles used throughout the app: owner > admin > editor > viewer
    role: text("role").notNull().default("editor"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("tenant_members_tenant_user_unique").on(t.tenantId, t.userId)],
);

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantMembers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [tenantMembers.userId], references: [users.id] }),
}));

// ─── Billing / Licensing (platform DB) ───────────────────────────────────────

/**
 * Plan definitions — managed by platform admin.
 * limits and enabledModules are JSON stored as text.
 */
export const billingPlans = pgTable("billing_plan", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(), // slug: free | basic | professional | enterprise | custom
  displayName: text("display_name").notNull(),
  description: text("description"),

  // Stripe product/price mapping
  stripeProductId: text("stripe_product_id"),
  stripePriceMonthlyId: text("stripe_price_monthly_id"),
  stripePriceAnnualId: text("stripe_price_annual_id"),
  stripeExtraUserMonthlyPriceId: text("stripe_extra_user_monthly_price_id"),
  stripeExtraUserAnnualPriceId: text("stripe_extra_user_annual_price_id"),

  // Pricing (in cents; 0 for free)
  pricePerUserMonthly: integer("price_per_user_monthly").default(0).notNull(),
  pricePerUserAnnual: integer("price_per_user_annual").default(0).notNull(),
  annualDiscountPercent: integer("annual_discount_percent").default(0).notNull(),

  // User seat rules
  includedUsers: integer("included_users").default(1).notNull(),
  maxUsers: integer("max_users"), // null = unlimited
  minUsers: integer("min_users").default(1).notNull(),
  extraUserPriceMonthly: integer("extra_user_price_monthly").default(0).notNull(),
  extraUserPriceAnnual: integer("extra_user_price_annual").default(0).notNull(),

  trialDays: integer("trial_days").default(0).notNull(),

  // JSON strings (parse at runtime)
  limits: text("limits").notNull().default("{}"), // PlanLimits
  enabledModules: text("enabled_modules").notNull().default('["crm"]'), // string[]

  supportTier: text("support_tier").default("community").notNull(),
  hasWhiteLabel: boolean("has_white_label").default(false).notNull(),
  hasSandbox: boolean("has_sandbox").default(false).notNull(),

  isActive: boolean("is_active").default(true).notNull(),
  isPublic: boolean("is_public").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isCustom: boolean("is_custom").default(false).notNull(),

  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/**
 * Active Stripe subscription per tenant (one active per tenant at most).
 */
export const billingSubscriptions = pgTable("billing_subscription", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  planId: text("plan_id").references(() => billingPlans.id),

  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionItemId: text("stripe_subscription_item_id"), // base seat item

  // trialing | active | past_due | canceled | suspended | free
  status: text("status").notNull().default("free"),
  billingCycle: text("billing_cycle").default("monthly").notNull(), // monthly | annual
  quantity: integer("quantity").default(1).notNull(), // billable user seats

  currentPeriodStart: timestamp("current_period_start", { mode: "date" }),
  currentPeriodEnd: timestamp("current_period_end", { mode: "date" }),
  trialEnd: timestamp("trial_end", { mode: "date" }),
  canceledAt: timestamp("canceled_at", { mode: "date" }),
  gracePeriodEnd: timestamp("grace_period_end", { mode: "date" }),

  currency: text("currency").default("eur").notNull(),

  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/**
 * Add-ons attached to a tenant (extra users, optional modules).
 * Each maps to a separate Stripe subscription item.
 */
export const billingTenantAddons = pgTable("billing_tenant_addon", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),

  // extra_users | helpdesk | advanced_reporting | white_label | sandbox
  addonType: text("addon_type").notNull(),
  quantity: integer("quantity").default(1).notNull(),

  stripeSubscriptionItemId: text("stripe_subscription_item_id"),
  stripePriceId: text("stripe_price_id"),

  // active | canceled
  status: text("status").default("active").notNull(),

  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/**
 * Monthly usage counters per tenant.
 * Unique on (tenantId, metricType, periodStart) — upserted each time.
 */
export const billingUsageStats = pgTable(
  "billing_usage_stat",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    metricType: text("metric_type").notNull(), // api_calls | storage_mb | automation_runs | active_users
    currentValue: integer("current_value").default(0).notNull(),
    periodStart: timestamp("period_start", { mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [unique("billing_usage_stat_unique").on(t.tenantId, t.metricType, t.periodStart)],
);

/**
 * Stripe webhook events — stored for idempotency and audit.
 */
export const billingStripeEvents = pgTable("billing_stripe_event", {
  id: text("id").primaryKey(), // Stripe event ID
  type: text("type").notNull(),
  tenantId: text("tenant_id"),
  payload: text("payload").notNull(), // raw JSON
  processedAt: timestamp("processed_at", { mode: "date" }),
  error: text("error"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/**
 * Threshold alerts (usage approaching plan limit).
 */
export const billingAlerts = pgTable("billing_alert", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  metricType: text("metric_type").notNull(),
  thresholdPercent: integer("threshold_percent").notNull(), // 80 | 90 | 100
  sentAt: timestamp("sent_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/**
 * Immutable audit log of all entitlement changes.
 */
export const billingAuditLog = pgTable("billing_audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id").notNull(),
  eventType: text("event_type").notNull(), // plan_changed | addon_added | addon_removed | suspended | reactivated
  previousValue: text("previous_value"), // JSON snapshot
  newValue: text("new_value"), // JSON snapshot
  triggeredBy: text("triggered_by"), // 'stripe_webhook' | 'admin:{userId}' | 'system'
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// ─── Billing relations ────────────────────────────────────────────────────────

export const billingSubscriptionsRelations = relations(billingSubscriptions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [billingSubscriptions.tenantId], references: [tenants.id] }),
  plan: one(billingPlans, { fields: [billingSubscriptions.planId], references: [billingPlans.id] }),
  addons: many(billingTenantAddons),
}));

export const billingTenantAddonsRelations = relations(billingTenantAddons, ({ one }) => ({
  tenant: one(tenants, { fields: [billingTenantAddons.tenantId], references: [tenants.id] }),
}));

export const billingUsageStatsRelations = relations(billingUsageStats, ({ one }) => ({
  tenant: one(tenants, { fields: [billingUsageStats.tenantId], references: [tenants.id] }),
}));

export const companyCategoriesRelations = relations(companyCategories, ({ many }) => ({
  companies: many(companies),
}));

export const companyTypesRelations = relations(companyTypes, ({ many }) => ({
  companies: many(companies),
}));

// ─── PLATFORM RATE-LIMIT ENTRIES ──────────────────────────────────────────────
// Distributed rate limiter state stored in the platform DB.
// Shared across all server instances; survives cold starts.
// Rows can be pruned at any time: DELETE FROM ratelimit_entry WHERE reset_at < NOW()

export const rateLimitEntries = pgTable("ratelimit_entry", {
  key: text("key").primaryKey().notNull(),
  count: integer("count").notNull().default(1),
  resetAt: timestamp("reset_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

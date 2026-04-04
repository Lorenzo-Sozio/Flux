import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  numeric,
  boolean,
} from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "next-auth/adapters"

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
})

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
  })
)

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
)

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
  vatNumber: text("vat_number"),
  sdiCode: text("sdi_code"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
})

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
  marketingConsent: boolean("marketing_consent").default(false),
  consentDate: timestamp("consent_date", { mode: "date" }),
  tags: text("tags").array(),
  isConverted: boolean("is_converted").default(false).notNull(), // Added this line
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
})

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
  marketingConsent: boolean("marketing_consent").default(false),
  consentDate: timestamp("consent_date", { mode: "date" }),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
})

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
})


export const products = pgTable("product", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  sku: text("sku"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
})

export const orders = pgTable("order", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderNumber: text("order_number").notNull().unique(),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").default("draft").notNull(), // draft, processing, completed, cancelled
  orderDate: timestamp("order_date", { mode: "date" }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
})

export const orderItems = pgTable("order_item", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
})

import { relations } from "drizzle-orm";

export const pipelineStages = pgTable("pipeline_stage", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  color: text("color"),
  defaultProbability: integer("default_probability").default(0),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const deals = pgTable("deal", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  currency: text("currency").default("USD").notNull(),
  probability: integer("probability").default(0),
  expectedCloseDate: timestamp("expected_close_date", { mode: "date" }),
  stageId: text("stage_id").references(() => pipelineStages.id, { onDelete: "restrict" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").default("open").notNull(), // open, won, lost
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
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text("type").notNull(), // note, call, meeting, email
  content: text("content"),
  date: timestamp("date", { mode: "date" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const tasks = pgTable("task", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { mode: "date" }),
  status: text("status").default("todo").notNull(), // todo, done
  priority: text("priority").default("normal").notNull(), // low, normal, high
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const emailTemplates = pgTable("email_template", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
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
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").default("draft").notNull(), // draft, active, completed
  templateId: text("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const campaignLogs = pgTable("campaign_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaignId: text("campaign_id").references(() => marketingCampaigns.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at", { mode: "date" }).defaultNow().notNull(),
  status: text("status").default("sent").notNull(), // sent, opened, clicked, failed
});

// --- CUSTOM FILTERS ---
export const customFilters = pgTable("custom_filter", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  entityType: text("entity_type").notNull(), // leads, contacts, companies, deals, activities, tasks
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  criteria: text("criteria").notNull(), // JSON stringified array of filter conditions
  isPublic: boolean("is_public").default(false), // true = shared with team
  isPinned: boolean("is_pinned").default(false), // true = shows in quick access
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const customFilterTags = pgTable("custom_filter_tag", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  filterId: text("filter_id").references(() => customFilters.id, { onDelete: "cascade" }).notNull(),
  tag: text("tag").notNull(), // e.g., "sales", "high-priority", "q2-2026"
});

export const filterPresets = pgTable("filter_preset", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
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

export const tasksRelations = relations(tasks, ({ one }) => ({
  owner: one(users, { fields: [tasks.ownerId], references: [users.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [tasks.companyId], references: [companies.id] }),
  deal: one(deals, { fields: [tasks.dealId], references: [deals.id] }),
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
  (t) => ({ compoundKey: primaryKey({ columns: [t.identifier, t.token] }) })
);

// --- USER INVITATIONS ---
export const userInvitations = pgTable("user_invitation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: text("role").default("user").notNull(), // owner, admin, user, viewer
  invitedById: text("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- IN-APP NOTIFICATIONS ---
export const notifications = pgTable("notification", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // task_due, deal_won, lead_assigned, email_sent, system
  title: text("title").notNull(),
  message: text("message"),
  link: text("link"), // /dashboard/tasks/123
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- CUSTOM FIELD DEFINITIONS ---
export const customFieldDefinitions = pgTable("custom_field_definition", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),         // e.g. "LinkedIn URL"
  slug: text("slug").notNull(),          // e.g. "linkedin_url"
  entityType: text("entity_type").notNull(), // contact, lead, company, deal
  fieldType: text("field_type").notNull(),   // text, number, date, select, multiselect, boolean, url
  options: text("options"),              // JSON array for select/multiselect options
  isRequired: boolean("is_required").default(false).notNull(),
  order: integer("order").default(0).notNull(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- CUSTOM FIELD VALUES ---
export const customFieldValues = pgTable("custom_field_value", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  fieldId: text("field_id").notNull().references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // contact, lead, company, deal
  entityId: text("entity_id").notNull(),
  value: text("value"),                       // stored as text, cast on read based on fieldType
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- DOCUMENTS / ATTACHMENTS ---
export const documents = pgTable("document", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  url: text("url").notNull(),             // S3/Uploadthing URL
  mimeType: text("mime_type"),
  size: integer("size"),                  // bytes
  version: integer("version").default(1).notNull(),
  entityType: text("entity_type"),        // contact, deal, lead, company
  entityId: text("entity_id"),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

// --- WEBHOOKS ---
export const webhooks = pgTable("webhook", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: text("events").array().notNull(), // ["contact.created", "deal.won", ...]
  secret: text("secret"),                   // for HMAC signature verification
  isActive: boolean("is_active").default(true).notNull(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: text("payload"),               // JSON
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

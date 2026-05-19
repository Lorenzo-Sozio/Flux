import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const marketingCampaign = pgTable(
  "marketing_campaign",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    status: text().default("draft").notNull(),
    templateId: text("template_id"),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.templateId],
      foreignColumns: [emailTemplate.id],
      name: "marketing_campaign_template_id_email_template_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "marketing_campaign_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const userInvitation = pgTable(
  "user_invitation",
  {
    id: text().primaryKey().notNull(),
    email: text().notNull(),
    token: text().notNull(),
    role: text().default("user").notNull(),
    invitedById: text("invited_by_id"),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.invitedById],
      foreignColumns: [user.id],
      name: "user_invitation_invited_by_id_user_id_fk",
    }).onDelete("set null"),
    unique("user_invitation_token_unique").on(table.token),
  ],
);

export const customFieldDefinition = pgTable(
  "custom_field_definition",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    entityType: text("entity_type").notNull(),
    fieldType: text("field_type").notNull(),
    options: text(),
    isRequired: boolean("is_required").default(false).notNull(),
    order: integer().default(0).notNull(),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "custom_field_definition_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const notification = pgTable(
  "notification",
  {
    id: text().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    type: text().notNull(),
    title: text().notNull(),
    message: text(),
    link: text(),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "notification_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const customFieldValue = pgTable(
  "custom_field_value",
  {
    id: text().primaryKey().notNull(),
    fieldId: text("field_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    value: text(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.fieldId],
      foreignColumns: [customFieldDefinition.id],
      name: "custom_field_value_field_id_custom_field_definition_id_fk",
    }).onDelete("cascade"),
  ],
);

export const document = pgTable(
  "document",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    url: text().notNull(),
    mimeType: text("mime_type"),
    size: integer(),
    version: integer().default(1).notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "document_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const lead = pgTable(
  "lead",
  {
    id: text().primaryKey().notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    jobTitle: text("job_title"),
    email: text(),
    phone: text(),
    mobile: text(),
    companyName: text("company_name"),
    industry: text(),
    website: text(),
    street: text(),
    city: text(),
    state: text(),
    zipCode: text("zip_code"),
    country: text(),
    status: text().default("new").notNull(),
    source: text(),
    rating: text(),
    notes: text(),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    leadScore: integer("lead_score"),
    marketingConsent: boolean("marketing_consent").default(false),
    consentDate: timestamp("consent_date", { mode: "string" }),
    tags: text().array(),
    isConverted: boolean("is_converted").default(false).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "lead_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const company = pgTable(
  "company",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    industry: text(),
    website: text(),
    description: text(),
    type: text().default("prospect"),
    employeeCount: integer("employee_count"),
    annualRevenue: numeric("annual_revenue", { precision: 15, scale: 2 }),
    street: text(),
    city: text(),
    state: text(),
    zipCode: text("zip_code"),
    country: text(),
    mainPhone: text("main_phone"),
    mainEmail: text("main_email"),
    linkedinUrl: text("linkedin_url"),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    status: text().default("active").notNull(),
    source: text(),
    leadScore: integer("lead_score"),
    vatNumber: text("vat_number"),
    sdiCode: text("sdi_code"),
    tags: text().array(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "company_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const opportunity = pgTable(
  "opportunity",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    amount: numeric({ precision: 12, scale: 2 }),
    stage: text().default("prospecting").notNull(),
    probability: integer(),
    expectedCloseDate: timestamp("expected_close_date", { mode: "string" }),
    companyId: text("company_id"),
    contactId: text("contact_id"),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "opportunity_company_id_company_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "opportunity_contact_id_contact_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "opportunity_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const contact = pgTable(
  "contact",
  {
    id: text().primaryKey().notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    jobTitle: text("job_title"),
    department: text(),
    email: text(),
    phone: text(),
    mobile: text(),
    linkedinUrl: text("linkedin_url"),
    street: text(),
    city: text(),
    state: text(),
    zipCode: text("zip_code"),
    country: text(),
    notes: text(),
    companyId: text("company_id"),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    status: text().default("active").notNull(),
    source: text(),
    leadScore: integer("lead_score"),
    marketingConsent: boolean("marketing_consent").default(false),
    consentDate: timestamp("consent_date", { mode: "string" }),
    tags: text().array(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "contact_company_id_company_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "contact_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const orderItem = pgTable(
  "order_item",
  {
    id: text().primaryKey().notNull(),
    orderId: text("order_id").notNull(),
    productId: text("product_id").notNull(),
    quantity: integer().notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [order.id],
      name: "order_item_order_id_order_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [product.id],
      name: "order_item_product_id_product_id_fk",
    }).onDelete("restrict"),
  ],
);

export const session = pgTable(
  "session",
  {
    sessionToken: text().primaryKey().notNull(),
    userId: text().notNull(),
    expires: timestamp({ mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "session_userId_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const user = pgTable(
  "user",
  {
    id: text().primaryKey().notNull(),
    name: text(),
    email: text(),
    emailVerified: timestamp({ mode: "string" }),
    image: text(),
    password: text(),
    role: text().default("user").notNull(),
  },
  (table) => [unique("user_email_unique").on(table.email)],
);

export const order = pgTable(
  "order",
  {
    id: text().primaryKey().notNull(),
    orderNumber: text("order_number").notNull(),
    companyId: text("company_id"),
    contactId: text("contact_id"),
    opportunityId: text("opportunity_id"),
    ownerId: text("owner_id"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    status: text().default("draft").notNull(),
    orderDate: timestamp("order_date", { mode: "string" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "order_company_id_company_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "order_contact_id_contact_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.opportunityId],
      foreignColumns: [opportunity.id],
      name: "order_opportunity_id_opportunity_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "order_owner_id_user_id_fk",
    }).onDelete("set null"),
    unique("order_order_number_unique").on(table.orderNumber),
  ],
);

export const product = pgTable("product", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  description: text(),
  sku: text(),
  price: numeric({ precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});

export const webhook = pgTable(
  "webhook",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    url: text().notNull(),
    events: text().array().notNull(),
    secret: text(),
    isActive: boolean("is_active").default(true).notNull(),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "webhook_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const activity = pgTable(
  "activity",
  {
    id: text().primaryKey().notNull(),
    type: text().notNull(),
    leadId: text("lead_id"),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    content: text(),
    date: timestamp({ mode: "string" }),
    ownerId: text("owner_id"),
    dealId: text("deal_id"),
    durationMinutes: integer("duration_minutes"),
    reminderMinutes: integer("reminder_minutes"),
    participants: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "activity_owner_id_user_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.dealId],
      foreignColumns: [deal.id],
      name: "activity_deal_id_deal_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.leadId],
      foreignColumns: [lead.id],
      name: "activity_lead_id_lead_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "activity_contact_id_contact_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "activity_company_id_company_id_fk",
    }).onDelete("cascade"),
  ],
);

export const webhookLog = pgTable(
  "webhook_log",
  {
    id: text().primaryKey().notNull(),
    webhookId: text("webhook_id").notNull(),
    event: text().notNull(),
    payload: text(),
    statusCode: integer("status_code"),
    response: text(),
    sentAt: timestamp("sent_at", { mode: "string" }).defaultNow().notNull(),
    success: boolean().default(false).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.webhookId],
      foreignColumns: [webhook.id],
      name: "webhook_log_webhook_id_webhook_id_fk",
    }).onDelete("cascade"),
  ],
);

export const deal = pgTable(
  "deal",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    amount: numeric({ precision: 12, scale: 2 }),
    currency: text().default("USD").notNull(),
    expectedCloseDate: timestamp("expected_close_date", { mode: "string" }),
    stageId: text("stage_id"),
    companyId: text("company_id"),
    contactId: text("contact_id"),
    ownerId: text("owner_id"),
    status: text().default("open").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    probability: integer().default(0),
    notes: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.stageId],
      foreignColumns: [pipelineStage.id],
      name: "deal_stage_id_pipeline_stage_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "deal_company_id_company_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "deal_contact_id_contact_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "deal_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const task = pgTable(
  "task",
  {
    id: text().primaryKey().notNull(),
    title: text().notNull(),
    description: text(),
    dueDate: timestamp("due_date", { mode: "string" }),
    status: text().default("todo").notNull(),
    priority: text().default("normal").notNull(),
    ownerId: text("owner_id"),
    leadId: text("lead_id"),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    dealId: text("deal_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    assigneeId: text("assignee_id"),
    completedAt: timestamp("completed_at", { mode: "string" }),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "task_owner_id_user_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.leadId],
      foreignColumns: [lead.id],
      name: "task_lead_id_lead_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "task_contact_id_contact_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "task_company_id_company_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.dealId],
      foreignColumns: [deal.id],
      name: "task_deal_id_deal_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.assigneeId],
      foreignColumns: [user.id],
      name: "task_assignee_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const pipelineStage = pgTable("pipeline_stage", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  order: integer().notNull(),
  color: text(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  defaultProbability: integer("default_probability").default(0),
});

export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: text().primaryKey().notNull(),
    email: text().notNull(),
    reason: text().default("unsubscribe").notNull(),
    campaignId: text("campaign_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [unique("email_suppression_email_unique").on(table.email)],
);

export const customFilter = pgTable(
  "custom_filter",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    entityType: text("entity_type").notNull(),
    ownerId: text("owner_id").notNull(),
    criteria: text().notNull(),
    isPublic: boolean("is_public").default(false),
    isPinned: boolean("is_pinned").default(false),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "custom_filter_owner_id_user_id_fk",
    }).onDelete("cascade"),
  ],
);

export const customFilterTag = pgTable(
  "custom_filter_tag",
  {
    id: text().primaryKey().notNull(),
    filterId: text("filter_id").notNull(),
    tag: text().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.filterId],
      foreignColumns: [customFilter.id],
      name: "custom_filter_tag_filter_id_custom_filter_id_fk",
    }).onDelete("cascade"),
  ],
);

export const filterPreset = pgTable("filter_preset", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  description: text(),
  entityType: text("entity_type").notNull(),
  defaultCriteria: text("default_criteria").notNull(),
  isSystem: boolean("is_system").default(false),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const emailTemplate = pgTable(
  "email_template",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    description: text(),
    isHtml: boolean("is_html").default(true).notNull(),
    category: text().default("general").notNull(),
    previewText: text("preview_text"),
    tags: text().array().default([""]),
    isPublic: boolean("is_public").default(false),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "email_template_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const campaignLog = pgTable(
  "campaign_log",
  {
    id: text().primaryKey().notNull(),
    campaignId: text("campaign_id"),
    leadId: text("lead_id"),
    contactId: text("contact_id"),
    sentAt: timestamp("sent_at", { mode: "string" }).defaultNow().notNull(),
    status: text().default("queued").notNull(),
    openedAt: timestamp("opened_at", { mode: "string" }),
    clickedAt: timestamp("clicked_at", { mode: "string" }),
    errorMessage: text("error_message"),
    messageId: text("message_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.campaignId],
      foreignColumns: [marketingCampaign.id],
      name: "campaign_log_campaign_id_marketing_campaign_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.leadId],
      foreignColumns: [lead.id],
      name: "campaign_log_lead_id_lead_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "campaign_log_contact_id_contact_id_fk",
    }).onDelete("cascade"),
  ],
);

export const emailSettings = pgTable("email_settings", {
  id: text().primaryKey().notNull(),
  provider: text().default("resend").notNull(),
  resendApiKey: text("resend_api_key"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").default(587),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpSecure: boolean("smtp_secure").default(false),
  fromEmail: text("from_email").default("noreply@yourdomain.com").notNull(),
  fromName: text("from_name").default("CRM").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});

export const emailJob = pgTable(
  "email_job",
  {
    id: text().primaryKey().notNull(),
    campaignId: text("campaign_id"),
    campaignLogId: text("campaign_log_id"),
    toEmail: text("to_email").notNull(),
    subject: text().notNull(),
    htmlBody: text("html_body").notNull(),
    status: text().default("pending").notNull(),
    attempts: integer().default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { mode: "string" }).defaultNow(),
    processedAt: timestamp("processed_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.campaignId],
      foreignColumns: [marketingCampaign.id],
      name: "email_job_campaign_id_marketing_campaign_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.campaignLogId],
      foreignColumns: [campaignLog.id],
      name: "email_job_campaign_log_id_campaign_log_id_fk",
    }).onDelete("cascade"),
  ],
);

export const automationLog = pgTable(
  "automation_log",
  {
    id: text().primaryKey().notNull(),
    ruleId: text("rule_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    event: text().notNull(),
    success: boolean().notNull(),
    actionsExecuted: integer("actions_executed").default(0).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    loopDetected: boolean("loop_detected").default(false).notNull(),
    loopInfo: text("loop_info"),
    retryCount: integer("retry_count").default(0).notNull(),
    retryInfo: text("retry_info"),
  },
  (table) => [
    foreignKey({
      columns: [table.ruleId],
      foreignColumns: [automationRule.id],
      name: "automation_log_rule_id_automation_rule_id_fk",
    }).onDelete("cascade"),
  ],
);

export const automationRule = pgTable(
  "automation_rule",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    isActive: boolean("is_active").default(true).notNull(),
    targetEntity: text("target_entity").notNull(),
    triggerOn: text("trigger_on").array().notNull(),
    conditionLogic: text("condition_logic").default("AND").notNull(),
    conditions: text().notNull(),
    actions: text().notNull(),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    conditionExpression: text("condition_expression"),
  },
  (table) => [
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "automation_rule_owner_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const chatChannel = pgTable("chat_channel", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  type: text().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  config: text(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const quoteActivity = pgTable(
  "quote_activity",
  {
    id: text().primaryKey().notNull(),
    quoteId: text("quote_id").notNull(),
    type: text().notNull(),
    userId: text("user_id"),
    email: text(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.quoteId],
      foreignColumns: [quote.id],
      name: "quote_activity_quote_id_quote_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "quote_activity_user_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const quoteItem = pgTable(
  "quote_item",
  {
    id: text().primaryKey().notNull(),
    quoteId: text("quote_id").notNull(),
    productId: text("product_id"),
    description: text(),
    quantity: integer().notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
    taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0"),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.quoteId],
      foreignColumns: [quote.id],
      name: "quote_item_quote_id_quote_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [product.id],
      name: "quote_item_product_id_product_id_fk",
    }).onDelete("set null"),
  ],
);

export const ticket = pgTable(
  "ticket",
  {
    id: text().primaryKey().notNull(),
    ticketNumber: text("ticket_number").notNull(),
    subject: text().notNull(),
    description: text(),
    channel: text().notNull(),
    priority: text().default("normal").notNull(),
    severity: text().default("normal").notNull(),
    status: text().default("open").notNull(),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    assigneeId: text("assignee_id"),
    ownerId: text("owner_id"),
    slaId: text("sla_id"),
    firstResponseAt: timestamp("first_response_at", { mode: "string" }),
    resolvedAt: timestamp("resolved_at", { mode: "string" }),
    closedAt: timestamp("closed_at", { mode: "string" }),
    tags: text().array().default([""]),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "ticket_contact_id_contact_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "ticket_company_id_company_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.assigneeId],
      foreignColumns: [user.id],
      name: "ticket_assignee_id_user_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "ticket_owner_id_user_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.slaId],
      foreignColumns: [sla.id],
      name: "ticket_sla_id_sla_id_fk",
    }).onDelete("set null"),
    unique("ticket_ticket_number_unique").on(table.ticketNumber),
  ],
);

export const chatSession = pgTable(
  "chat_session",
  {
    id: text().primaryKey().notNull(),
    ticketId: text("ticket_id"),
    channelId: text("channel_id"),
    visitorId: text("visitor_id"),
    visitorEmail: text("visitor_email"),
    visitorName: text("visitor_name"),
    status: text().default("active").notNull(),
    assignedAgentId: text("assigned_agent_id"),
    startedAt: timestamp("started_at", { mode: "string" }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [ticket.id],
      name: "chat_session_ticket_id_ticket_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.channelId],
      foreignColumns: [chatChannel.id],
      name: "chat_session_channel_id_chat_channel_id_fk",
    }),
    foreignKey({
      columns: [table.assignedAgentId],
      foreignColumns: [user.id],
      name: "chat_session_assigned_agent_id_user_id_fk",
    }),
  ],
);

export const quote = pgTable(
  "quote",
  {
    id: text().primaryKey().notNull(),
    quoteNumber: text("quote_number").notNull(),
    dealId: text("deal_id").notNull(),
    companyId: text("company_id").notNull(),
    contactId: text("contact_id"),
    ownerId: text("owner_id"),
    status: text().default("draft").notNull(),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).default("0"),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).default("0"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0"),
    taxPercent: numeric("tax_percent", { precision: 5, scale: 2 }).default("0"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    currency: text().default("USD").notNull(),
    issuedAt: timestamp("issued_at", { mode: "string" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }),
    sentAt: timestamp("sent_at", { mode: "string" }),
    viewedAt: timestamp("viewed_at", { mode: "string" }),
    acceptedAt: timestamp("accepted_at", { mode: "string" }),
    declinedAt: timestamp("declined_at", { mode: "string" }),
    declineReason: text("decline_reason"),
    version: integer().default(1).notNull(),
    notes: text(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.dealId],
      foreignColumns: [deal.id],
      name: "quote_deal_id_deal_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.companyId],
      foreignColumns: [company.id],
      name: "quote_company_id_company_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.contactId],
      foreignColumns: [contact.id],
      name: "quote_contact_id_contact_id_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [user.id],
      name: "quote_owner_id_user_id_fk",
    }).onDelete("set null"),
    unique("quote_quote_number_unique").on(table.quoteNumber),
  ],
);

export const ticketMessage = pgTable(
  "ticket_message",
  {
    id: text().primaryKey().notNull(),
    ticketId: text("ticket_id").notNull(),
    senderId: text("sender_id"),
    senderEmail: text("sender_email"),
    senderName: text("sender_name"),
    channel: text().notNull(),
    content: text().notNull(),
    isPublic: boolean("is_public").default(true).notNull(),
    attachmentIds: text("attachment_ids").array().default([""]),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [ticket.id],
      name: "ticket_message_ticket_id_ticket_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.senderId],
      foreignColumns: [user.id],
      name: "ticket_message_sender_id_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const sla = pgTable("sla", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  description: text(),
  priority: text().notNull(),
  firstResponseTimeMinutes: integer("first_response_time_minutes").notNull(),
  resolutionTimeMinutes: integer("resolution_time_minutes").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const passwordResetToken = pgTable(
  "password_reset_token",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token], name: "password_reset_token_identifier_token_pk" }),
  ],
);

export const verificationToken = pgTable(
  "verificationToken",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: "string" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token], name: "verificationToken_identifier_token_pk" })],
);

export const account = pgTable(
  "account",
  {
    userId: text().notNull(),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text(),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "account_userId_user_id_fk",
    }).onDelete("cascade"),
    primaryKey({ columns: [table.provider, table.providerAccountId], name: "account_provider_providerAccountId_pk" }),
  ],
);

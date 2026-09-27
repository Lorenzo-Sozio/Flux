// Tenant-only schema: everything except platform registry tables (tenants, tenantMembers).
// Used by migrateTenantDb() so that platform tables are never pushed to tenant databases.
export {
  accounts,
  activities,
  activitiesRelations,
  // Notifications
  // API idempotency
  apiIdempotency,
  // Scoped machine-to-machine keys
  apiKeys,
  // Who wrote through the API
  apiWriteLog,
  appointmentAttendees,
  appointmentAttendeesRelations,
  // A person's own mailbox
  appointmentMirrors,
  // Appointments
  appointments,
  appointmentsRelations,
  automationLogs,
  automationLogsRelations,
  // Automation
  automationRules,
  automationRulesRelations,
  bookingLinks,
  businessCalendar,
  businessHolidays,
  campaignLogs,
  campaignLogsRelations,
  // Commissions
  commissionLines,
  commissionRules,
  commissionStatements,
  // Chat / DM
  // CRM core
  companies,
  contacts,
  contactsRelations,
  // Contracts
  contracts,
  // Custom fields
  customFieldDefinitions,
  customFieldDefinitionsRelations,
  customFieldValues,
  customFieldValuesRelations,
  // Filters
  customFilters,
  customFiltersRelations,
  customFilterTags,
  customFilterTagsRelations,
  dealComments,
  dealCommentsRelations,
  dealLossReasons,
  deals,
  dealsRelations,
  dmAttachments,
  dmAttachmentsRelations,
  dmConversationMembers,
  dmConversationMembersRelations,
  dmConversations,
  dmConversationsRelations,
  dmMessages,
  dmMessagesRelations,
  // Document numbering
  documentCounters,
  // Documents
  documents,
  emailJobs,
  // Follow-up sequences
  emailSequenceEnrollments,
  emailSequenceSteps,
  emailSequences,
  emailSettings,
  emailSuppressions,
  // Marketing / email
  emailTemplates,
  emailTemplatesRelations,
  // Exchange rates cache
  exchangeRatesCache,
  fieldChanges,
  filterPresets,
  geoCities,
  // Geo reference
  geoCountries,
  // Invoicing
  invoiceIssuers,
  invoiceItems,
  invoices,
  leads,
  leadsRelations,
  mailArchiveAddresses,
  mailBusy,
  mailConnections,
  marketingCampaigns,
  marketingCampaignsRelations,
  nextActionSnoozes,
  notificationPreferences,
  notifications,
  notificationsRelations,
  orderItems,
  orders,
  passwordResetTokens,
  // Pipeline / deals
  pipelineStages,
  pipelineStagesRelations,
  pipelines,
  // Price lists
  priceListItems,
  priceLists,
  // Products / orders / quotes
  products,
  // Web push
  pushSubscriptions,
  quoteActivities,
  quoteActivitiesRelations,
  quoteItems,
  quoteItemsRelations,
  quotes,
  quotesRelations,
  // Finance
  salesTargets,
  salesTargetsRelations,
  // Reports
  savedReports,
  savedReportsRelations,
  sessions,
  slas,
  slasRelations,
  taskAssignees,
  taskAssigneesRelations,
  taskDependencies,
  taskDependenciesRelations,
  // Tasks
  tasks,
  tasksRelations,
  taskTimeLogs,
  taskTimeLogsRelations,
  // Territories
  territories,
  ticketAuditLogs,
  ticketAuditLogsRelations,
  ticketMacros,
  ticketMacrosRelations,
  ticketMessages,
  ticketMessagesRelations,
  // Support / tickets
  tickets,
  ticketsRelations,
  userActivityLogs,
  userActivityLogsRelations,
  userGroupMembers,
  userGroupMembersRelations,
  userGroups,
  userGroupsRelations,
  userInvitations,
  userInvitationsRelations,
  // Auth / users
  users,
  verificationTokens,
  webForms,
  webhookLogs,
  webhookLogsRelations,
  // Webhooks
  webhooks,
  webhooksRelations,
  workspaceSettings,
} from "./schema";

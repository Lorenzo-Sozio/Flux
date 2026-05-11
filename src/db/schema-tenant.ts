// Tenant-only schema: everything except platform registry tables (tenants, tenantMembers).
// Used by migrateTenantDb() so that platform tables are never pushed to tenant databases.
export {
  // Auth / users
  users,
  userGroups,
  userGroupMembers,
  accounts,
  sessions,
  verificationTokens,
  passwordResetTokens,
  userInvitations,
  userActivityLogs,
  userGroupsRelations,
  userGroupMembersRelations,
  userInvitationsRelations,
  userActivityLogsRelations,

  // Geo reference
  geoCountries,
  geoCities,

  // CRM core
  companies,
  leads,
  contacts,
  opportunities,
  activities,
  activitiesRelations,
  leadsRelations,
  contactsRelations,

  // Tasks
  tasks,
  taskTimeLogs,
  taskAssignees,
  taskDependencies,
  tasksRelations,
  taskDependenciesRelations,
  taskAssigneesRelations,
  taskTimeLogsRelations,

  // Pipeline / deals
  pipelineStages,
  deals,
  pipelineStagesRelations,
  dealsRelations,
  dealComments,
  dealCommentsRelations,

  // Products / orders / quotes
  products,
  orders,
  orderItems,
  quotes,
  quoteItems,
  quoteActivities,
  quotesRelations,
  quoteItemsRelations,
  quoteActivitiesRelations,

  // Finance
  salesTargets,
  salesTargetsRelations,

  // Marketing / email
  emailTemplates,
  marketingCampaigns,
  campaignLogs,
  emailSettings,
  emailJobs,
  emailSuppressions,
  emailTemplatesRelations,
  marketingCampaignsRelations,
  campaignLogsRelations,

  // Support / tickets
  tickets,
  ticketMessages,
  ticketAuditLogs,
  ticketMacros,
  slas,
  ticketsRelations,
  ticketMessagesRelations,
  ticketAuditLogsRelations,
  ticketMacrosRelations,
  slasRelations,

  // Notifications
  notifications,
  notificationsRelations,

  // Custom fields
  customFieldDefinitions,
  customFieldValues,
  customFieldDefinitionsRelations,
  customFieldValuesRelations,

  // Filters
  customFilters,
  customFilterTags,
  filterPresets,
  customFiltersRelations,
  customFilterTagsRelations,

  // Documents
  documents,

  // Webhooks
  webhooks,
  webhookLogs,
  webhooksRelations,
  webhookLogsRelations,

  // Automation
  automationRules,
  automationLogs,
  automationRulesRelations,
  automationLogsRelations,

  // Appointments
  appointments,
  appointmentAttendees,
  appointmentsRelations,
  appointmentAttendeesRelations,

  // Chat / DM
  chatChannels,
  chatSessions,
  dmConversations,
  dmConversationMembers,
  dmMessages,
  chatChannelsRelations,
  chatSessionsRelations,
  dmConversationsRelations,
  dmConversationMembersRelations,
  dmMessagesRelations,

  // Reports
  savedReports,
  savedReportsRelations,

  // Exchange rates cache
  exchangeRatesCache,
} from "./schema";

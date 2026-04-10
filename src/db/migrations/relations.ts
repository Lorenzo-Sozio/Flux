import { relations } from "drizzle-orm/relations";
import { emailTemplate, marketingCampaign, user, userInvitation, customFieldDefinition, notification, customFieldValue, document, lead, company, opportunity, contact, order, orderItem, product, session, webhook, activity, deal, webhookLog, pipelineStage, task, customFilter, customFilterTag, campaignLog, emailJob, automationRule, automationLog, quote, quoteActivity, quoteItem, ticket, sla, chatSession, chatChannel, ticketMessage, account } from "./schema";

export const marketingCampaignRelations = relations(marketingCampaign, ({one, many}) => ({
	emailTemplate: one(emailTemplate, {
		fields: [marketingCampaign.templateId],
		references: [emailTemplate.id]
	}),
	user: one(user, {
		fields: [marketingCampaign.ownerId],
		references: [user.id]
	}),
	campaignLogs: many(campaignLog),
	emailJobs: many(emailJob),
}));

export const emailTemplateRelations = relations(emailTemplate, ({one, many}) => ({
	marketingCampaigns: many(marketingCampaign),
	user: one(user, {
		fields: [emailTemplate.ownerId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	marketingCampaigns: many(marketingCampaign),
	userInvitations: many(userInvitation),
	customFieldDefinitions: many(customFieldDefinition),
	notifications: many(notification),
	documents: many(document),
	leads: many(lead),
	companies: many(company),
	opportunities: many(opportunity),
	contacts: many(contact),
	sessions: many(session),
	orders: many(order),
	webhooks: many(webhook),
	activities: many(activity),
	deals: many(deal),
	tasks_ownerId: many(task, {
		relationName: "task_ownerId_user_id"
	}),
	tasks_assigneeId: many(task, {
		relationName: "task_assigneeId_user_id"
	}),
	customFilters: many(customFilter),
	emailTemplates: many(emailTemplate),
	automationRules: many(automationRule),
	quoteActivities: many(quoteActivity),
	tickets_assigneeId: many(ticket, {
		relationName: "ticket_assigneeId_user_id"
	}),
	tickets_ownerId: many(ticket, {
		relationName: "ticket_ownerId_user_id"
	}),
	chatSessions: many(chatSession),
	quotes: many(quote),
	ticketMessages: many(ticketMessage),
	accounts: many(account),
}));

export const userInvitationRelations = relations(userInvitation, ({one}) => ({
	user: one(user, {
		fields: [userInvitation.invitedById],
		references: [user.id]
	}),
}));

export const customFieldDefinitionRelations = relations(customFieldDefinition, ({one, many}) => ({
	user: one(user, {
		fields: [customFieldDefinition.ownerId],
		references: [user.id]
	}),
	customFieldValues: many(customFieldValue),
}));

export const notificationRelations = relations(notification, ({one}) => ({
	user: one(user, {
		fields: [notification.userId],
		references: [user.id]
	}),
}));

export const customFieldValueRelations = relations(customFieldValue, ({one}) => ({
	customFieldDefinition: one(customFieldDefinition, {
		fields: [customFieldValue.fieldId],
		references: [customFieldDefinition.id]
	}),
}));

export const documentRelations = relations(document, ({one}) => ({
	user: one(user, {
		fields: [document.ownerId],
		references: [user.id]
	}),
}));

export const leadRelations = relations(lead, ({one, many}) => ({
	user: one(user, {
		fields: [lead.ownerId],
		references: [user.id]
	}),
	activities: many(activity),
	tasks: many(task),
	campaignLogs: many(campaignLog),
}));

export const companyRelations = relations(company, ({one, many}) => ({
	user: one(user, {
		fields: [company.ownerId],
		references: [user.id]
	}),
	opportunities: many(opportunity),
	contacts: many(contact),
	orders: many(order),
	activities: many(activity),
	deals: many(deal),
	tasks: many(task),
	tickets: many(ticket),
	quotes: many(quote),
}));

export const opportunityRelations = relations(opportunity, ({one, many}) => ({
	company: one(company, {
		fields: [opportunity.companyId],
		references: [company.id]
	}),
	contact: one(contact, {
		fields: [opportunity.contactId],
		references: [contact.id]
	}),
	user: one(user, {
		fields: [opportunity.ownerId],
		references: [user.id]
	}),
	orders: many(order),
}));

export const contactRelations = relations(contact, ({one, many}) => ({
	opportunities: many(opportunity),
	company: one(company, {
		fields: [contact.companyId],
		references: [company.id]
	}),
	user: one(user, {
		fields: [contact.ownerId],
		references: [user.id]
	}),
	orders: many(order),
	activities: many(activity),
	deals: many(deal),
	tasks: many(task),
	campaignLogs: many(campaignLog),
	tickets: many(ticket),
	quotes: many(quote),
}));

export const orderItemRelations = relations(orderItem, ({one}) => ({
	order: one(order, {
		fields: [orderItem.orderId],
		references: [order.id]
	}),
	product: one(product, {
		fields: [orderItem.productId],
		references: [product.id]
	}),
}));

export const orderRelations = relations(order, ({one, many}) => ({
	orderItems: many(orderItem),
	company: one(company, {
		fields: [order.companyId],
		references: [company.id]
	}),
	contact: one(contact, {
		fields: [order.contactId],
		references: [contact.id]
	}),
	opportunity: one(opportunity, {
		fields: [order.opportunityId],
		references: [opportunity.id]
	}),
	user: one(user, {
		fields: [order.ownerId],
		references: [user.id]
	}),
}));

export const productRelations = relations(product, ({many}) => ({
	orderItems: many(orderItem),
	quoteItems: many(quoteItem),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));

export const webhookRelations = relations(webhook, ({one, many}) => ({
	user: one(user, {
		fields: [webhook.ownerId],
		references: [user.id]
	}),
	webhookLogs: many(webhookLog),
}));

export const activityRelations = relations(activity, ({one}) => ({
	user: one(user, {
		fields: [activity.ownerId],
		references: [user.id]
	}),
	deal: one(deal, {
		fields: [activity.dealId],
		references: [deal.id]
	}),
	lead: one(lead, {
		fields: [activity.leadId],
		references: [lead.id]
	}),
	contact: one(contact, {
		fields: [activity.contactId],
		references: [contact.id]
	}),
	company: one(company, {
		fields: [activity.companyId],
		references: [company.id]
	}),
}));

export const dealRelations = relations(deal, ({one, many}) => ({
	activities: many(activity),
	pipelineStage: one(pipelineStage, {
		fields: [deal.stageId],
		references: [pipelineStage.id]
	}),
	company: one(company, {
		fields: [deal.companyId],
		references: [company.id]
	}),
	contact: one(contact, {
		fields: [deal.contactId],
		references: [contact.id]
	}),
	user: one(user, {
		fields: [deal.ownerId],
		references: [user.id]
	}),
	tasks: many(task),
	quotes: many(quote),
}));

export const webhookLogRelations = relations(webhookLog, ({one}) => ({
	webhook: one(webhook, {
		fields: [webhookLog.webhookId],
		references: [webhook.id]
	}),
}));

export const pipelineStageRelations = relations(pipelineStage, ({many}) => ({
	deals: many(deal),
}));

export const taskRelations = relations(task, ({one}) => ({
	user_ownerId: one(user, {
		fields: [task.ownerId],
		references: [user.id],
		relationName: "task_ownerId_user_id"
	}),
	lead: one(lead, {
		fields: [task.leadId],
		references: [lead.id]
	}),
	contact: one(contact, {
		fields: [task.contactId],
		references: [contact.id]
	}),
	company: one(company, {
		fields: [task.companyId],
		references: [company.id]
	}),
	deal: one(deal, {
		fields: [task.dealId],
		references: [deal.id]
	}),
	user_assigneeId: one(user, {
		fields: [task.assigneeId],
		references: [user.id],
		relationName: "task_assigneeId_user_id"
	}),
}));

export const customFilterRelations = relations(customFilter, ({one, many}) => ({
	user: one(user, {
		fields: [customFilter.ownerId],
		references: [user.id]
	}),
	customFilterTags: many(customFilterTag),
}));

export const customFilterTagRelations = relations(customFilterTag, ({one}) => ({
	customFilter: one(customFilter, {
		fields: [customFilterTag.filterId],
		references: [customFilter.id]
	}),
}));

export const campaignLogRelations = relations(campaignLog, ({one, many}) => ({
	marketingCampaign: one(marketingCampaign, {
		fields: [campaignLog.campaignId],
		references: [marketingCampaign.id]
	}),
	lead: one(lead, {
		fields: [campaignLog.leadId],
		references: [lead.id]
	}),
	contact: one(contact, {
		fields: [campaignLog.contactId],
		references: [contact.id]
	}),
	emailJobs: many(emailJob),
}));

export const emailJobRelations = relations(emailJob, ({one}) => ({
	marketingCampaign: one(marketingCampaign, {
		fields: [emailJob.campaignId],
		references: [marketingCampaign.id]
	}),
	campaignLog: one(campaignLog, {
		fields: [emailJob.campaignLogId],
		references: [campaignLog.id]
	}),
}));

export const automationLogRelations = relations(automationLog, ({one}) => ({
	automationRule: one(automationRule, {
		fields: [automationLog.ruleId],
		references: [automationRule.id]
	}),
}));

export const automationRuleRelations = relations(automationRule, ({one, many}) => ({
	automationLogs: many(automationLog),
	user: one(user, {
		fields: [automationRule.ownerId],
		references: [user.id]
	}),
}));

export const quoteActivityRelations = relations(quoteActivity, ({one}) => ({
	quote: one(quote, {
		fields: [quoteActivity.quoteId],
		references: [quote.id]
	}),
	user: one(user, {
		fields: [quoteActivity.userId],
		references: [user.id]
	}),
}));

export const quoteRelations = relations(quote, ({one, many}) => ({
	quoteActivities: many(quoteActivity),
	quoteItems: many(quoteItem),
	deal: one(deal, {
		fields: [quote.dealId],
		references: [deal.id]
	}),
	company: one(company, {
		fields: [quote.companyId],
		references: [company.id]
	}),
	contact: one(contact, {
		fields: [quote.contactId],
		references: [contact.id]
	}),
	user: one(user, {
		fields: [quote.ownerId],
		references: [user.id]
	}),
}));

export const quoteItemRelations = relations(quoteItem, ({one}) => ({
	quote: one(quote, {
		fields: [quoteItem.quoteId],
		references: [quote.id]
	}),
	product: one(product, {
		fields: [quoteItem.productId],
		references: [product.id]
	}),
}));

export const ticketRelations = relations(ticket, ({one, many}) => ({
	contact: one(contact, {
		fields: [ticket.contactId],
		references: [contact.id]
	}),
	company: one(company, {
		fields: [ticket.companyId],
		references: [company.id]
	}),
	user_assigneeId: one(user, {
		fields: [ticket.assigneeId],
		references: [user.id],
		relationName: "ticket_assigneeId_user_id"
	}),
	user_ownerId: one(user, {
		fields: [ticket.ownerId],
		references: [user.id],
		relationName: "ticket_ownerId_user_id"
	}),
	sla: one(sla, {
		fields: [ticket.slaId],
		references: [sla.id]
	}),
	chatSessions: many(chatSession),
	ticketMessages: many(ticketMessage),
}));

export const slaRelations = relations(sla, ({many}) => ({
	tickets: many(ticket),
}));

export const chatSessionRelations = relations(chatSession, ({one}) => ({
	ticket: one(ticket, {
		fields: [chatSession.ticketId],
		references: [ticket.id]
	}),
	chatChannel: one(chatChannel, {
		fields: [chatSession.channelId],
		references: [chatChannel.id]
	}),
	user: one(user, {
		fields: [chatSession.assignedAgentId],
		references: [user.id]
	}),
}));

export const chatChannelRelations = relations(chatChannel, ({many}) => ({
	chatSessions: many(chatSession),
}));

export const ticketMessageRelations = relations(ticketMessage, ({one}) => ({
	ticket: one(ticket, {
		fields: [ticketMessage.ticketId],
		references: [ticket.id]
	}),
	user: one(user, {
		fields: [ticketMessage.senderId],
		references: [user.id]
	}),
}));

export const accountRelations = relations(account, ({one}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
}));
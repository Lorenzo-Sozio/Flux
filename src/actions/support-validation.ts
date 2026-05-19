import { z } from "zod";

// ── Ticket schemas ───────────────────────────────────────────────────────────

export const TICKET_TYPE_VALUES = ["support", "bug", "complaint", "info_request", "internal_task"] as const;
export const TICKET_STATUS_VALUES = ["new", "open", "in_progress", "waiting", "on_hold", "resolved", "closed"] as const;

export const CreateTicketSchema = z.object({
  subject: z.string().min(1, "Subject required"),
  description: z.string().optional(),
  channel: z.enum(["email", "chat", "phone", "social"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  severity: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  type: z.enum(TICKET_TYPE_VALUES).default("support"),
  component: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  groupId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  contactId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  companyId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  leadId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  assigneeId: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  tags: z.array(z.string()).default([]),
});

export const UpdateTicketSchema = z.object({
  subject: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(TICKET_STATUS_VALUES).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  severity: z.enum(["low", "normal", "high", "critical"]).optional(),
  type: z.enum(TICKET_TYPE_VALUES).optional(),
  component: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

export const AddMessageSchema = z.object({
  content: z.string().min(1),
  channel: z.enum(["email", "chat", "phone", "social"]),
  isPublic: z.boolean().default(true),
  senderEmail: z.string().optional(),
  senderName: z.string().optional(),
});

// ── SLA schemas ──────────────────────────────────────────────────────────────

export const CreateSLASchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  firstResponseTimeMinutes: z.number().int().positive(),
  resolutionTimeMinutes: z.number().int().positive(),
});

export const UpdateSLASchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  firstResponseTimeMinutes: z.number().int().positive().optional(),
  resolutionTimeMinutes: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

// ── Macro schemas ────────────────────────────────────────────────────────────

export const CreateMacroSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  body: z.string().min(1, "Body required"),
  isPublic: z.boolean().default(true),
});

export const UpdateMacroSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  body: z.string().min(1).optional(),
  isPublic: z.boolean().optional(),
});

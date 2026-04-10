import { z } from "zod";

// ── Ticket schemas ───────────────────────────────────────────────────────────

export const CreateTicketSchema = z.object({
  subject: z.string().min(1, "Subject required"),
  description: z.string().optional(),
  channel: z.enum(["email", "chat", "phone", "social"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  severity: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  contactId: z.string().optional(),
  companyId: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const UpdateTicketSchema = z.object({
  subject: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "waiting", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  severity: z.enum(["low", "normal", "high", "critical"]).optional(),
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

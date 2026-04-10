import { z } from "zod";

export const SlaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  firstResponseTimeMinutes: z.coerce.number().int().positive("Must be a positive integer"),
  resolutionTimeMinutes: z.coerce.number().int().positive("Must be a positive integer"),
  isActive: z.boolean().default(true),
});

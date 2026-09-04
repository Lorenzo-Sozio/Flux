import { z } from "zod";

export const SlaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  firstResponseTimeMinutes: z.coerce.number().int().positive("Must be a positive integer"),
  resolutionTimeMinutes: z.coerce.number().int().positive("Must be a positive integer"),
  // ⚠️ Both of these existed in the table and in no form. `useBusinessHours`
  // arrived with the working-hours calendar and could only be set through an
  // action no page calls, so the switch that stops the SLA clock at closing time
  // could not be reached from the product at all (audit rilievo S-07).
  useBusinessHours: z.boolean().default(false),
  escalationGroupId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

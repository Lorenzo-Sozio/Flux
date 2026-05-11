import { z } from "zod";

export const QuoteItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  quantity: z.coerce.number().int().positive("Quantity must be a positive integer"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
});

export const CreateQuoteSchema = z.object({
  dealId: z.string().min(1, "Deal is required"),
  companyId: z.string().min(1, "Company is required"),
  contactId: z.string().optional(),
  expiresAt: z.string().optional(),
  currency: z.string().default("EUR"),
  items: z.array(QuoteItemSchema).min(1, "At least one item is required"),
  notes: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
});

export const UpdateQuoteSchema = z.object({
  status: z.enum(["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"]).optional(),
  notes: z.string().optional(),
  items: z.array(QuoteItemSchema).optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  dealId: z.string().optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  expiresAt: z.string().optional(),
});

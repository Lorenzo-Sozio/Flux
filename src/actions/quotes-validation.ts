import { z } from "zod";

export const QuoteItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1, "validation.quotes.descriptionRequired"),
  quantity: z.coerce.number().int().positive("validation.quotes.quantityPositive"),
  unitPrice: z.coerce.number().min(0, "validation.quotes.unitPriceNegative"),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
});

export const CreateQuoteSchema = z.object({
  dealId: z.string().min(1, "validation.quotes.dealRequired"),
  companyId: z.string().min(1, "validation.quotes.companyRequired"),
  contactId: z.string().optional(),
  expiresAt: z.string().optional(),
  currency: z.string().default("EUR"),
  items: z.array(QuoteItemSchema).min(1, "validation.quotes.itemsRequired"),
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

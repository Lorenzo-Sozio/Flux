import { z } from "zod";

import { BILLING_PERIODS } from "@/lib/contract-terms";

/**
 * What the contract form accepts, so a mistake is named next to the field rather
 * than as a sentence at the top after the save. Messages are `validation.*` keys,
 * translated where they are shown (see src/lib/i18n-message.ts).
 *
 * ⚠️ The server does not trust it: `cleanContract` checks the same rules again on
 * what arrives, because this schema runs in a browser.
 */
export const ContractFormSchema = z
  .object({
    title: z.string().trim().min(1, "validation.contracts.titleRequired").max(200),
    companyId: z.string().min(1, "validation.contracts.companyRequired"),
    contactId: z.string().optional(),
    ownerId: z.string().optional(),
    status: z.enum(["draft", "active", "cancelled"]).default("active"),
    amount: z.coerce.number().min(0, "validation.contracts.amountNegative"),
    currency: z.string().trim().length(3).default("EUR"),
    billingPeriod: z.enum(BILLING_PERIODS).default("annual"),
    startDate: z.string().min(1, "validation.contracts.startDateRequired"),
    endDate: z.string().optional(),
    autoRenew: z.boolean().default(false),
    renewalTermMonths: z.coerce.number().int().min(1).max(120).optional(),
    noticeDays: z.coerce.number().int().min(0).max(365).default(30),
    notes: z.string().optional(),
  })
  .refine((c) => !c.endDate || c.endDate >= c.startDate, {
    message: "validation.contracts.endBeforeStart",
    path: ["endDate"],
  })
  .refine((c) => !c.autoRenew || Boolean(c.endDate), {
    // Renewing needs something to renew from: without an end date it never falls due.
    message: "validation.contracts.autoRenewNeedsEnd",
    path: ["endDate"],
  })
  .refine((c) => !c.autoRenew || Boolean(c.renewalTermMonths), {
    message: "validation.contracts.renewalTermRequired",
    path: ["renewalTermMonths"],
  });

export type ContractFormValues = z.input<typeof ContractFormSchema>;

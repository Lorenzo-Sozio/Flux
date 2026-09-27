import type { Tone } from "@/components/crm/record/record-page";
import type { PaymentState } from "@/lib/order-payment";

/**
 * The colours an order's two states are drawn in, in the five shared tones.
 *
 * One map for the hero and the payments card, so "part paid" is amber in both —
 * the payments card used to carry its own palette (rose, amber, emerald, sky) and
 * the hero had none, which is how the same word ends up two colours on one screen.
 * Server-safe on purpose: the page is a server component and the card is not.
 */
export const ORDER_STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  processing: "info",
  completed: "success",
  cancelled: "danger",
};

export const PAYMENT_TONE: Record<PaymentState, Tone> = {
  unpaid: "danger",
  partial: "warning",
  paid: "success",
  overpaid: "info",
};

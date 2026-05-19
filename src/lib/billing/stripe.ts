/**
 * Lazy Stripe client.
 *
 * The client is created on first use, not at import time.
 * This means missing STRIPE_SECRET_KEY does NOT crash server startup or
 * non-billing routes — it only throws when a billing action is actually invoked.
 */
import Stripe from "stripe";

let _instance: Stripe | null = null;

export function getStripe(): Stripe {
  if (_instance) return _instance;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env to enable billing features.");
  }

  _instance = new Stripe(key, {
    apiVersion: "2026-04-22.dahlia",
    typescript: true,
  });

  return _instance;
}

export type { Stripe };

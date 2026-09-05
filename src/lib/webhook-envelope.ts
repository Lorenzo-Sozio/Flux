/**
 * The envelope an event travels in, and the rules for retrying it. **No imports.**
 *
 * ⚠️ These live here rather than in `actions/webhooks` for a layering reason: that module
 * is a server action and drags authentication in behind it, so a library importing one
 * constant from it also imports next-auth. A test showed it — the test would not start —
 * but the defect was not the test's: a library that depends on an action has its arrows
 * pointing the wrong way.
 */

/** Who caused the change that produced the event. */
export interface Origin {
  /** `api` = a machine wrote through the API; `user` = somebody in the interface. */
  via: "api" | "user" | "system";
  /** The user's id, where there is one. Machines do not have one. */
  actor?: string | null;
}

/**
 * ⚠️ **`id` exists so that a receiver can tell a retry from a second event.** Without it,
 * an integration handed the same delivery twice — which any reliable transport eventually
 * does — has no way of knowing, and acts twice. It is generated once per event and stays
 * the same on every attempt.
 *
 * ⚠️ **`origin` exists so that nobody chases their own tail.** An integration writes a lead
 * through the API, this CRM emits `lead.created`, and the integration receives it: unless
 * it can tell the change was its own, it reacts to itself and does not stop.
 */
export interface EventEnvelope {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
  origin: Origin;
}

/**
 * The prefix that marks an attempt which **never left**, because the webhook has no secret.
 *
 * ⚠️ It is what separates that from a failed delivery: a failure is retried, this is not —
 * retrying does not add a secret, and would repeat a row asking for configuration for days.
 * It is written here and read in two places: two spellings would be an endless retry.
 */
export const UNSIGNABLE_PREFIX = "not delivered: this webhook has no secret";

/** How many attempts before giving up: with no limit, an address that no longer exists
 * would be called for ever. */
export const MAX_ATTEMPTS = 5;

/** How long to wait between attempts. The last wait repeats: a provider that has been
 * down for hours should not be hammered, nor abandoned before its time. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 3 * 60 * 60_000];

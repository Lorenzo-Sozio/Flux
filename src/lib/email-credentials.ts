import { encryptSecret, looksEncrypted, tryDecryptSecret } from "@/lib/tenant-db";

/**
 * A workspace's email credentials at rest: its Resend API key and its SMTP password.
 *
 * ⚠️⚠️ They were stored in plaintext in each workspace's own database, while the
 * platform's own email credentials beside them were encrypted. Anyone with read
 * access to a customer's database — a backup, a replica, a support session, a
 * leaked connection string — read a live key that sends mail as that customer.
 *
 * Three rules, one per function below:
 *
 *   * a value typed into the settings screen is encrypted before it is written;
 *   * reading accepts both shapes, so the rows written before this change keep
 *     sending mail on the day it deploys;
 *   * a row still in plaintext is encrypted the first time the workspace sends,
 *     so nobody has to run anything and nothing stays plaintext for long.
 *
 * Encrypted with the platform key, which `scripts/rotate-platform-key.ts` already
 * reads these columns for.
 */

/** The placeholder the settings screen shows in place of a stored secret. */
export const MASK = "••••••••";

export type SecretChange = { kind: "keep" } | { kind: "clear" } | { kind: "set"; stored: string };

/**
 * What a submitted form field means for the stored secret.
 *
 * The screen never receives the real value, only the mask, so a form saved without
 * touching the field sends the mask back — and writing that would replace a working
 * key with eight bullet characters.
 */
export function changeFor(submitted: string | undefined): SecretChange {
  if (submitted === undefined) return { kind: "keep" };
  if (submitted === "") return { kind: "clear" };
  if (submitted.includes("•")) return { kind: "keep" };
  return { kind: "set", stored: encryptSecret(submitted) };
}

/** The usable value of a stored secret, whichever shape it was stored in. */
export function openSecret(stored: string | null | undefined): string | null {
  return tryDecryptSecret(stored);
}

/**
 * The encrypted form of a secret that is still stored in plaintext, or null when
 * there is nothing to convert.
 *
 * ⚠️ A value that merely *looks* encrypted — a plaintext password that happens to
 * contain exactly two colons — is left alone rather than encrypted twice. It keeps
 * working, because reading falls back to returning it as it is.
 */
export function sealIfPlaintext(stored: string | null | undefined): string | null {
  if (!stored || looksEncrypted(stored)) return null;
  return encryptSecret(stored);
}

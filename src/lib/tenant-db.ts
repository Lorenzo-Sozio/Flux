/**
 * AES-256-GCM encryption for tenant DB connection strings.
 * Server-only — never imported by client components or middleware.
 *
 * Requires env var: PLATFORM_ENCRYPTION_KEY (64 hex chars = 32 bytes)
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * What this key protects, and nothing else: `tenants.db_url` for every workspace,
 * and `email_settings.resend_api_key` / `smtp_password`, all in the platform
 * database. `scripts/rotate-platform-key.ts` re-encrypts exactly those.
 *
 * ## ⚠️⚠️ Rotating the key
 *
 * The obvious order — re-encrypt the rows, then change the Worker's secret — has a
 * gap in the middle where production holds the old key and the database holds
 * values it cannot read, and every workspace is unreachable until the secret
 * catches up. The other order has the same gap the other way round.
 *
 * So decryption accepts a second, previous key. The rotation is:
 *
 *   1. set PLATFORM_ENCRYPTION_KEY to the new key and
 *      PLATFORM_ENCRYPTION_KEY_PREVIOUS to the old one — the app now reads both
 *      and writes with the new one;
 *   2. run the rotation script, which rewrites every value with the new key;
 *   3. remove PLATFORM_ENCRYPTION_KEY_PREVIOUS.
 *
 * At no point does the running app hold a value it cannot decrypt.
 *
 * Trying a second key cannot produce garbage: GCM authenticates, so the wrong key
 * fails loudly at the tag check rather than returning plausible bytes.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * Turns an environment value into a key, or says precisely what is wrong with it.
 *
 * Trims and strips surrounding quotes, as the original reader did, because a key
 * pasted into a dashboard with its quotes is the common way this goes wrong.
 */
export function parseEncryptionKey(value: string | undefined, name: string): Buffer {
  const raw = value?.trim().replace(/^["']|["']$/g, "");
  if (!raw || raw.length !== 64 || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(
      `${name} invalid: got ${raw === undefined ? "undefined" : `"${raw.slice(0, 4)}…" (length ${raw.length})`}`,
    );
  }
  return Buffer.from(raw, "hex");
}

function currentKey(): Buffer {
  return parseEncryptionKey(process.env.PLATFORM_ENCRYPTION_KEY, "PLATFORM_ENCRYPTION_KEY");
}

/**
 * The key being rotated away from, when a rotation is in progress.
 *
 * Read only after the current key has failed, so a malformed or stale value here
 * cannot break the decryption of anything the current key can already read.
 */
function previousKey(): Buffer | null {
  const raw = process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS;
  if (!raw?.trim()) return null;
  return parseEncryptionKey(raw, "PLATFORM_ENCRYPTION_KEY_PREVIOUS");
}

/** Encrypts with an explicit key. For the rotation script and the tests. */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/** True when a stored value has the shape this module writes. */
export function looksEncrypted(stored: string | null | undefined): stored is string {
  return typeof stored === "string" && stored.split(":").length === 3;
}

/**
 * Decrypts with an explicit key, and throws if that key did not encrypt it.
 * For the rotation script and the tests.
 */
export function decryptWithKey(stored: string, key: Buffer): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivHex, authTagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
}

/** Encrypts a secret value (API key, password, etc.) using AES-256-GCM, always with the current key. */
export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, currentKey());
}

/**
 * Decrypts a value encrypted by encryptSecret.
 *
 * The current key first; during a rotation, the previous key when the current one
 * does not fit. See the top of this file for why both exist.
 */
export function decryptSecret(stored: string): string {
  if (!looksEncrypted(stored)) throw new Error("Invalid encrypted secret format");
  const key = currentKey();
  try {
    return decryptWithKey(stored, key);
  } catch {
    const previous = previousKey();
    if (previous && !previous.equals(key)) {
      try {
        return decryptWithKey(stored, previous);
      } catch {
        // Falls through to the error below: neither key encrypted this value.
      }
    }
    throw new Error("Failed to decrypt secret. The value may be corrupted or the encryption key may have changed.");
  }
}

/**
 * Decrypts a stored secret, falling back to returning the raw value if it's
 * not in encrypted format (handles plaintext values written before encryption was added).
 */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!looksEncrypted(stored)) return stored; // plaintext fallback
  try {
    return decryptSecret(stored);
  } catch {
    return stored; // decryption failed — treat as plaintext
  }
}

export const encryptDbUrl = encryptSecret;
export const decryptDbUrl = decryptSecret;

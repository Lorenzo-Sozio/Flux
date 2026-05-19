/**
 * AES-256-GCM encryption for tenant DB connection strings.
 * Server-only — never imported by client components or middleware.
 *
 * Requires env var: PLATFORM_ENCRYPTION_KEY (64 hex chars = 32 bytes)
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.PLATFORM_ENCRYPTION_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!raw || raw.length !== 64 || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(
      `PLATFORM_ENCRYPTION_KEY invalid: got ${raw === undefined ? "undefined" : `"${raw.slice(0, 4)}…" (length ${raw.length})`}`,
    );
  }
  return Buffer.from(raw, "hex");
}

/** Encrypts a secret value (API key, password, etc.) using AES-256-GCM. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/** Decrypts a value encrypted by encryptSecret. Returns null if value is null/empty. */
export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivHex, authTagHex, dataHex] = parts;
  const key = getKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
  } catch {
    throw new Error("Failed to decrypt secret. The value may be corrupted or the encryption key may have changed.");
  }
}

/**
 * Decrypts a stored secret, falling back to returning the raw value if it's
 * not in encrypted format (handles plaintext values written before encryption was added).
 */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 3) return stored; // plaintext fallback
  try {
    return decryptSecret(stored);
  } catch {
    return stored; // decryption failed — treat as plaintext
  }
}

export const encryptDbUrl = encryptSecret;
export const decryptDbUrl = decryptSecret;

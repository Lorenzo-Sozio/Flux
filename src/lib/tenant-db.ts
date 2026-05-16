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
      "PLATFORM_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes)",
    );
  }
  return Buffer.from(raw, "hex");
}

export function encryptDbUrl(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptDbUrl(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted DB URL format");
  const [ivHex, authTagHex, dataHex] = parts;
  const key = getKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return (
      decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") +
      decipher.final("utf8")
    );
  } catch {
    throw new Error("Failed to decrypt tenant database URL. The value may be corrupted or the encryption key may have changed.");
  }
}

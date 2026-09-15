import { decryptWithKey, encryptWithKey, looksEncrypted } from "@/lib/tenant-db";

/**
 * Deciding what a key rotation rewrites, before anything is written.
 *
 * Pure, so the decision can be tested exhaustively and the script that runs it
 * does nothing but read, write and check. Every rule here exists because getting
 * it wrong is either an outage or a silent loss:
 *
 *   * **A value neither key can read blocks the whole rotation.** It means the
 *     old key given is not the one in use, or the value is damaged. Rewriting the
 *     others and leaving that one would produce a database readable by no single
 *     key, and a rotation that looked like it had succeeded.
 *   * **A value the new key already reads is left alone.** That is what makes a
 *     rotation that stopped halfway safe to run again: the finished rows are
 *     recognised instead of being encrypted a second time over the top.
 *   * **A value that is not encrypted at all is left alone and reported.** Some
 *     secrets were written before encryption existed. Changing what a row means
 *     is not a rotation's job, and doing it silently in the middle of one would
 *     make the rollback restore something different from what was there.
 *   * **Every new ciphertext is decrypted again before it is accepted.** A bad
 *     write is caught here, not by the first request after the switch.
 */

export interface EncryptedField {
  /** Where the value lives: `platform` or the workspace id. */
  database: string;
  table: string;
  column: string;
  /** The row's primary key. */
  id: string;
  stored: string | null;
}

export type FieldPlan =
  | { field: EncryptedField; action: "rotate"; plaintext: string; next: string }
  | { field: EncryptedField; action: "empty" }
  | { field: EncryptedField; action: "plaintext" }
  | { field: EncryptedField; action: "already-rotated"; plaintext: string }
  | { field: EncryptedField; action: "unreadable" };

export interface RotationPlan {
  fields: FieldPlan[];
  /** Nothing may be written while this is non-empty. */
  unreadable: EncryptedField[];
  counts: Record<FieldPlan["action"], number>;
}

export function planRotation(fields: readonly EncryptedField[], oldKey: Buffer, newKey: Buffer): RotationPlan {
  if (oldKey.equals(newKey)) {
    // Not a rotation, and running it would rewrite every value for nothing while
    // reporting success.
    throw new Error("The old and new keys are the same key.");
  }

  const planned: FieldPlan[] = fields.map((field) => {
    if (!field.stored) return { field, action: "empty" };
    if (!looksEncrypted(field.stored)) return { field, action: "plaintext" };

    const underNew = tryDecrypt(field.stored, newKey);
    if (underNew !== null) return { field, action: "already-rotated", plaintext: underNew };

    const plaintext = tryDecrypt(field.stored, oldKey);
    if (plaintext === null) return { field, action: "unreadable" };

    const next = encryptWithKey(plaintext, newKey);
    if (tryDecrypt(next, newKey) !== plaintext) {
      throw new Error(`Re-encryption did not round-trip for ${describe(field)}`);
    }
    return { field, action: "rotate", plaintext, next };
  });

  const counts = { rotate: 0, empty: 0, plaintext: 0, "already-rotated": 0, unreadable: 0 };
  for (const p of planned) counts[p.action]++;

  return {
    fields: planned,
    unreadable: planned.filter((p) => p.action === "unreadable").map((p) => p.field),
    counts,
  };
}

/** A location, never a value — this is what gets printed. */
export function describe(field: EncryptedField): string {
  return `${field.database}/${field.table}.${field.column}#${field.id}`;
}

function tryDecrypt(stored: string, key: Buffer): string | null {
  try {
    return decryptWithKey(stored, key);
  } catch {
    return null;
  }
}

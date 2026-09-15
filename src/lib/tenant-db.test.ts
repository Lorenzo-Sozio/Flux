/**
 * The key that decides which database a workspace opens.
 *
 * ⚠️⚠️ This is the boundary surface in the most literal sense: a connection string
 * decrypted wrongly is a request served from the wrong customer's database, or no
 * database at all. And rotating the key used to be impossible without every
 * workspace going dark for however long it took to change the Worker's secret.
 *
 * These pin both halves: that encryption still round-trips and refuses the wrong
 * key, and that a rotation can run with the app live because decryption accepts a
 * previous key while the rows are rewritten.
 */
import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptSecret,
  decryptWithKey,
  encryptSecret,
  encryptWithKey,
  looksEncrypted,
  parseEncryptionKey,
  tryDecryptSecret,
} from "./tenant-db";

const hex = () => randomBytes(32).toString("hex");
const URL = "postgresql://owner:secret@ep-example.eu-central-1.aws.neon.tech/workspace?sslmode=require";

let saved: { current?: string; previous?: string };

beforeEach(() => {
  saved = {
    current: process.env.PLATFORM_ENCRYPTION_KEY,
    previous: process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS,
  };
  delete process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  process.env.PLATFORM_ENCRYPTION_KEY = saved.current;
  if (saved.previous === undefined) delete process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS;
  else process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS = saved.previous;
});

describe("encrypting a connection string", () => {
  it("round-trips", () => {
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    expect(decryptSecret(encryptSecret(URL))).toBe(URL);
  });

  it("writes the three-part shape the database already holds", () => {
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    const stored = encryptSecret(URL);
    expect(stored.split(":")).toHaveLength(3);
    expect(looksEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("secret");
  });

  it("⚠️⚠️ refuses the wrong key rather than returning something", () => {
    // GCM authenticates. A wrong key must fail at the tag, never yield plausible
    // bytes that open some other database.
    const stored = encryptWithKey(URL, Buffer.from(hex(), "hex"));
    expect(() => decryptWithKey(stored, Buffer.from(hex(), "hex"))).toThrow();
  });

  it("⚠️ never encrypts the same value to the same text twice", () => {
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    expect(encryptSecret(URL)).not.toBe(encryptSecret(URL));
  });
});

describe("decrypting while a rotation is under way", () => {
  it("⚠️⚠️ reads a value written with the previous key", () => {
    // The whole point: rows not yet rewritten keep working while the script runs.
    const oldKey = hex();
    const stored = encryptWithKey(URL, Buffer.from(oldKey, "hex"));

    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS = oldKey;

    expect(decryptSecret(stored)).toBe(URL);
  });

  it("⚠️⚠️ does not read an old value once the previous key is gone", () => {
    // Removing the previous key is the last step of a rotation, and it has to
    // actually stop the old key working, or it was never rotated.
    const oldKey = hex();
    const stored = encryptWithKey(URL, Buffer.from(oldKey, "hex"));

    process.env.PLATFORM_ENCRYPTION_KEY = hex();

    expect(() => decryptSecret(stored)).toThrow(/Failed to decrypt/);
  });

  it("⚠️⚠️ always writes with the current key, never the previous one", () => {
    const current = hex();
    process.env.PLATFORM_ENCRYPTION_KEY = current;
    process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS = hex();

    const stored = encryptSecret(URL);
    expect(decryptWithKey(stored, Buffer.from(current, "hex"))).toBe(URL);
  });

  it("⚠️ is not broken by a malformed previous key when the current key fits", () => {
    // A typo in the variable that only matters mid-rotation must not take down
    // every workspace that the current key reads perfectly well.
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    const stored = encryptSecret(URL);
    process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS = "not-a-key";

    expect(decryptSecret(stored)).toBe(URL);
  });

  it("⚠️ treats an empty previous key as no previous key, and says what actually failed", () => {
    // After a rotation the variable is often emptied rather than deleted. The error
    // for a value nothing can read must still be about decryption; an error about
    // an invalid PREVIOUS key would send whoever is debugging to the one variable
    // that is not the problem.
    const stored = encryptWithKey(URL, Buffer.from(hex(), "hex"));
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    for (const empty of ["", "   "]) {
      process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS = empty;
      expect(() => decryptSecret(stored)).toThrow(/Failed to decrypt/);
    }
  });

  it("refuses a value neither key encrypted", () => {
    const stored = encryptWithKey(URL, Buffer.from(hex(), "hex"));
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    process.env.PLATFORM_ENCRYPTION_KEY_PREVIOUS = hex();

    expect(() => decryptSecret(stored)).toThrow(/Failed to decrypt/);
  });
});

describe("reading a key from the environment", () => {
  it("accepts the quotes a dashboard paste tends to carry", () => {
    const key = hex();
    expect(parseEncryptionKey(`"${key}"`, "K").equals(Buffer.from(key, "hex"))).toBe(true);
    expect(parseEncryptionKey(`  ${key}\n`, "K").equals(Buffer.from(key, "hex"))).toBe(true);
  });

  it("names the variable and the length when a key is wrong", () => {
    expect(() => parseEncryptionKey("abcd", "PLATFORM_ENCRYPTION_KEY")).toThrow(/PLATFORM_ENCRYPTION_KEY.*length 4/);
    expect(() => parseEncryptionKey(undefined, "X")).toThrow(/X invalid/);
    expect(() => parseEncryptionKey("z".repeat(64), "X")).toThrow();
  });

  it("never echoes more than the first four characters of a key", () => {
    const bad = `${hex()}ff`;
    try {
      parseEncryptionKey(bad, "K");
    } catch (e) {
      expect((e as Error).message).not.toContain(bad.slice(0, 10));
    }
  });
});

describe("values written before encryption existed", () => {
  it("are still returned as they are", () => {
    process.env.PLATFORM_ENCRYPTION_KEY = hex();
    expect(tryDecryptSecret("re_plaintextkey")).toBe("re_plaintextkey");
    expect(tryDecryptSecret(null)).toBeNull();
  });
});

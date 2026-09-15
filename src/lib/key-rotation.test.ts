/**
 * What a rotation of the platform key decides to rewrite.
 *
 * ⚠️⚠️ The rotation rewrites the connection string of every workspace. A wrong
 * decision here is either every customer unable to open their data, or a
 * rotation that reports success over a database no single key can read.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type EncryptedField, planRotation, describe as where } from "./key-rotation";
import { decryptWithKey, encryptWithKey } from "./tenant-db";

const key = () => randomBytes(32);
const URL = "postgresql://owner:secret@ep-example.neon.tech/workspace";

const field = (stored: string | null, id = "t1"): EncryptedField => ({
  database: "platform",
  table: "tenants",
  column: "db_url",
  id,
  stored,
});

describe("planning a rotation", () => {
  it("⚠️⚠️ re-encrypts a value under the new key, and the new text really opens with it", () => {
    const oldKey = key();
    const newKey = key();

    const plan = planRotation([field(encryptWithKey(URL, oldKey))], oldKey, newKey);
    const [only] = plan.fields;

    expect(only.action).toBe("rotate");
    if (only.action !== "rotate") return;
    expect(decryptWithKey(only.next, newKey)).toBe(URL);
    expect(() => decryptWithKey(only.next, oldKey)).toThrow();
  });

  it("⚠️⚠️ reports a value neither key can read, and marks the whole plan unwritable", () => {
    // The old key supplied is not the one in use, or the value is damaged. Writing
    // the others would leave a database no single key reads.
    const oldKey = key();
    const plan = planRotation(
      [field(encryptWithKey(URL, oldKey), "ok"), field(encryptWithKey(URL, key()), "stranger")],
      oldKey,
      key(),
    );

    expect(plan.unreadable.map((f) => f.id)).toEqual(["stranger"]);
    expect(plan.counts.unreadable).toBe(1);
  });

  it("⚠️⚠️ recognises a value already rotated, so a run that stopped halfway can simply run again", () => {
    const oldKey = key();
    const newKey = key();

    const plan = planRotation([field(encryptWithKey(URL, newKey))], oldKey, newKey);

    expect(plan.fields[0].action).toBe("already-rotated");
    expect(plan.unreadable).toEqual([]);
  });

  it("⚠️ leaves a value written before encryption existed exactly as it is", () => {
    // Changing what a row means is not a rotation's job, and doing it silently
    // would make the rollback restore something other than what was there.
    const plan = planRotation([field("re_plaintext_api_key")], key(), key());
    expect(plan.fields[0].action).toBe("plaintext");
    expect(plan.counts.rotate).toBe(0);
  });

  it("skips an empty value", () => {
    const plan = planRotation([field(null), field("")], key(), key());
    expect(plan.fields.map((p) => p.action)).toEqual(["empty", "empty"]);
  });

  it("⚠️ refuses to run with the same key twice", () => {
    const k = key();
    expect(() => planRotation([field(encryptWithKey(URL, k))], k, Buffer.from(k))).toThrow(/same key/);
  });

  it("counts every outcome, so the summary adds up", () => {
    const oldKey = key();
    const newKey = key();
    const plan = planRotation(
      [
        field(encryptWithKey(URL, oldKey), "a"),
        field(encryptWithKey(URL, newKey), "b"),
        field(null, "c"),
        field("plain", "d"),
        field(encryptWithKey(URL, key()), "e"),
      ],
      oldKey,
      newKey,
    );
    expect(plan.counts).toEqual({ rotate: 1, "already-rotated": 1, empty: 1, plaintext: 1, unreadable: 1 });
  });
});

describe("what the script prints about a field", () => {
  it("⚠️ names where the value lives and never the value", () => {
    const stored = encryptWithKey(URL, key());
    const text = where(field(stored, "tenant-42"));
    expect(text).toBe("platform/tenants.db_url#tenant-42");
    expect(text).not.toContain(stored.slice(0, 12));
    expect(text).not.toContain("secret");
  });
});

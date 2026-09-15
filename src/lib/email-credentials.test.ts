/**
 * A workspace's email credentials, at rest.
 *
 * ⚠️⚠️ These were plaintext in every customer's database. The failure modes of the
 * fix are both quiet: a key written in plaintext again looks exactly like a working
 * key, and a mask written over a real key looks like a saved form until the next
 * email bounces.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { changeFor, MASK, openSecret, sealIfPlaintext } from "./email-credentials";
import { looksEncrypted } from "./tenant-db";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.PLATFORM_ENCRYPTION_KEY;
  process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString("hex");
});
afterEach(() => {
  process.env.PLATFORM_ENCRYPTION_KEY = saved;
});

const KEY = "re_live_9f8e7d6c5b4a";

describe("saving a credential from the settings screen", () => {
  it("⚠️⚠️ stores it encrypted, never as typed", () => {
    const change = changeFor(KEY);
    expect(change.kind).toBe("set");
    if (change.kind !== "set") return;
    expect(change.stored).not.toContain(KEY);
    expect(looksEncrypted(change.stored)).toBe(true);
    expect(openSecret(change.stored)).toBe(KEY);
  });

  it("⚠️⚠️ keeps the stored key when the form sends back the mask", () => {
    // The screen never holds the real value. Saving the form without touching the
    // field must not replace a working key with bullet characters.
    expect(changeFor(MASK)).toEqual({ kind: "keep" });
  });

  it("keeps the stored key when the field was not sent at all", () => {
    expect(changeFor(undefined)).toEqual({ kind: "keep" });
  });

  it("clears it when the field is emptied", () => {
    expect(changeFor("")).toEqual({ kind: "clear" });
  });
});

describe("reading a credential to send mail", () => {
  it("⚠️⚠️ opens one stored encrypted", () => {
    const change = changeFor(KEY);
    if (change.kind !== "set") throw new Error("expected a set");
    expect(openSecret(change.stored)).toBe(KEY);
  });

  it("⚠️⚠️ still reads one stored in plaintext before this change", () => {
    // Rows written before the change must keep sending mail the day it deploys.
    expect(openSecret(KEY)).toBe(KEY);
  });

  it("reads nothing as nothing", () => {
    expect(openSecret(null)).toBeNull();
    expect(openSecret("")).toBeNull();
  });
});

describe("converting a row still in plaintext", () => {
  it("⚠️⚠️ encrypts it, and the result opens to the same key", () => {
    const sealed = sealIfPlaintext(KEY);
    expect(sealed).not.toBeNull();
    expect(sealed).not.toContain(KEY);
    expect(openSecret(sealed)).toBe(KEY);
  });

  it("⚠️ leaves an already encrypted value alone rather than encrypting it twice", () => {
    const change = changeFor(KEY);
    if (change.kind !== "set") throw new Error("expected a set");
    expect(sealIfPlaintext(change.stored)).toBeNull();
  });

  it("has nothing to do for an empty value", () => {
    expect(sealIfPlaintext(null)).toBeNull();
    expect(sealIfPlaintext("")).toBeNull();
  });
});

describe("the two places a workspace's credentials pass through", () => {
  // The rules above only protect anything if the real save and the real send use
  // them. Either reverting to the raw column would compile and pass every test in
  // this file.
  const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

  it("⚠️⚠️ the settings save encrypts through changeFor, and writes nothing raw", () => {
    const src = read("src/actions/email-settings.ts");
    expect(src).toContain("changeFor(submitted)");
    expect(src).not.toMatch(/secrets\.(resendApiKey|smtpPassword)\s*=\s*data\./);
  });

  it("⚠️⚠️ loading credentials to send mail opens both through openSecret", () => {
    const src = read("src/lib/email-provider.ts");
    expect(src).toContain("resendApiKey: openSecret(row.resendApiKey)");
    expect(src).toContain("smtpPassword: openSecret(row.smtpPassword)");
  });
});

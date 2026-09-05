/**
 * Which configuration a "send test" tests.
 *
 * On the tested surface because getting it wrong the first way handed the
 * workspace's mail password to whoever asked, and getting it wrong the second way
 * tells somebody a server works when a different one was tested. Both failures
 * look like a successful send.
 */
import { describe, expect, it } from "vitest";

import { chooseTestTarget, type StoredTarget, usesStoredSecret } from "./email-test-target";

const stored: StoredTarget = {
  provider: "smtp",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "postmaster@example.com",
};

describe("usesStoredSecret", () => {
  it("recognises the mask in either secret", () => {
    expect(usesStoredSecret({ smtpPassword: "••••••" })).toBe(true);
    expect(usesStoredSecret({ resendApiKey: "re_••••" })).toBe(true);
  });

  it("is false when a real secret was typed", () => {
    expect(usesStoredSecret({ smtpPassword: "hunter2" })).toBe(false);
    expect(usesStoredSecret({})).toBe(false);
  });
});

describe("chooseTestTarget", () => {
  it("uses what was submitted when a real secret came with it", () => {
    expect(chooseTestTarget({ smtpHost: "mail.other.com", smtpPassword: "typed" }, stored)).toEqual({
      use: "request",
    });
  });

  it("⚠️ never sends the stored secret to a server named in the request", () => {
    // The hole: mask the password, name your own host, receive the credentials.
    expect(chooseTestTarget({ smtpHost: "attacker.example", smtpPassword: "••••" }, stored)).toEqual({
      use: "refuse",
      reason: "changed-server",
    });
  });

  it("refuses when the user is the same but the host is not, and the other way round", () => {
    expect(chooseTestTarget({ smtpUser: "someone@else", smtpPassword: "••••" }, stored)).toMatchObject({
      use: "refuse",
    });
    expect(chooseTestTarget({ smtpPort: 2525, smtpPassword: "••••" }, stored)).toMatchObject({ use: "refuse" });
    expect(chooseTestTarget({ provider: "resend", resendApiKey: "••••" }, stored)).toMatchObject({ use: "refuse" });
  });

  it("tests the stored configuration when nothing about the server changed", () => {
    expect(
      chooseTestTarget(
        {
          provider: "smtp",
          smtpHost: "smtp.example.com",
          smtpPort: 587,
          smtpUser: "postmaster@example.com",
          smtpPassword: "••••",
        },
        stored,
      ),
    ).toEqual({ use: "stored" });
  });

  it("lets the sender's name and address change without refusing", () => {
    // Those travel with the message, not to another server, so the saved password
    // is still the right password.
    expect(chooseTestTarget({ smtpPassword: "••••" }, stored)).toEqual({ use: "stored" });
  });

  it("refuses when there is nothing saved to fall back to", () => {
    expect(chooseTestTarget({ smtpPassword: "••••" }, null)).toEqual({
      use: "refuse",
      reason: "no-stored-config",
    });
  });

  it("treats an empty host as no opinion rather than a change", () => {
    // The form sends empty strings for fields it does not show.
    expect(chooseTestTarget({ smtpHost: "", smtpUser: "", smtpPassword: "••••" }, stored)).toEqual({ use: "stored" });
  });
});

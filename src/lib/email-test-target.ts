/**
 * email-test-target.ts — which configuration a "send test" actually tests.
 *
 * ⚠️⚠️ This decision used to be made inline, and it was made wrongly in a way that
 * gave the workspace's mail password away. The form masks the stored secret, and
 * the action filled the real one back in **while taking the host from the
 * request** — so anyone with a session could post their own server beside the
 * mask and have the server connect to them carrying the real credentials.
 *
 * There are exactly three answers, and the rule is short enough to be read:
 *
 *  • Nothing masked — the caller supplied a whole configuration, test that.
 *  • Masked, and everything else matches what is stored — test the stored one.
 *  • Masked, but the server named is a different one — refuse. Testing the old
 *    server and reporting success would tell the user the new one works.
 *
 * Pure, so the rule can be tested without a database or a mail server.
 */

export interface TestTargetInput {
  provider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  resendApiKey?: string;
  smtpPassword?: string;
}

export interface StoredTarget {
  provider: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
}

export type TestTarget =
  | { use: "request" }
  | { use: "stored" }
  | { use: "refuse"; reason: "no-stored-config" | "changed-server" };

/** The character the form shows in place of a secret it will not send back. */
const MASK = "•";

export function usesStoredSecret(input: TestTargetInput): boolean {
  return Boolean(input.resendApiKey?.includes(MASK) || input.smtpPassword?.includes(MASK));
}

/** Which configuration to test, given what was submitted and what is stored. */
export function chooseTestTarget(input: TestTargetInput, stored: StoredTarget | null): TestTarget {
  if (!usesStoredSecret(input)) return { use: "request" };
  if (!stored) return { use: "refuse", reason: "no-stored-config" };

  // Only the fields that decide *where* the credentials go. The sender's name and
  // address travel with the message, not to a different server, so changing them
  // does not make the saved password the wrong password.
  const changed =
    (Boolean(input.provider) && input.provider !== stored.provider) ||
    (Boolean(input.smtpHost?.trim()) && input.smtpHost?.trim() !== (stored.smtpHost ?? "")) ||
    (Boolean(input.smtpUser?.trim()) && input.smtpUser?.trim() !== (stored.smtpUser ?? "")) ||
    (input.smtpPort !== undefined && input.smtpPort !== (stored.smtpPort ?? 587));

  return changed ? { use: "refuse", reason: "changed-server" } : { use: "stored" };
}

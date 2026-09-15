/**
 * The automation action that enrolls a record in a follow-up sequence.
 *
 * ⚠️ The line this holds: an ordinary refusal is a skip, and only a sequence that
 * cannot enroll anybody is a failure. A rule on every new lead that logged an
 * error for each lead without an email address would bury the one failure worth
 * reading — the sequence someone paused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let reason: string | null = null;
const calls: unknown[] = [];

vi.mock("@/lib/sequence-runner", () => ({
  enroll: async (_db: unknown, input: unknown) => {
    calls.push(input);
    return reason ? { ok: false, reason } : { ok: true, enrollmentId: "e1" };
  },
}));
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => ({}), getCurrentTenantId: async () => "t1" }));
vi.mock("@/db", () => ({ platformDb: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined }));
vi.mock("@/lib/document-counter", () => ({ nextInSequence: async () => 1 }));
vi.mock("@/actions/webhooks", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("../../crm/automation/webhook-service", () => ({ sendWebhook: async () => ({}) }));
vi.mock("../../crm/automation/email-service", () => ({ sendAutomationEmailWithContext: async () => ({}) }));
vi.mock("../../crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));
vi.mock("../../crm/automation/loop-detector", () => ({}));

const { ActionDispatcher } = await import("./action-dispatcher");
// biome-ignore lint/suspicious/noExplicitAny: reaching the private entry point
const run = (entityType: string) =>
  (new ActionDispatcher() as any).dispatch(
    { type: "enroll_in_sequence", params: { sequenceId: "s1" } },
    { entityType, entityId: "l1", event: "onCreate", newData: {}, currentUserId: "u7" },
    { ruleChain: [{ ruleId: "r1", timestamp: 0 }], depth: 1 },
  );

beforeEach(() => {
  reason = null;
  calls.length = 0;
});

describe("enrolling from a rule", () => {
  it("enrolls the record the rule fired on, on behalf of whoever caused it", async () => {
    await run("lead");
    expect(calls).toEqual([{ sequenceId: "s1", entity: "lead", recordId: "l1", enrolledBy: "u7" }]);
  });

  it("⚠️⚠️ skips, without failing, a record that cannot be enrolled for an ordinary reason", async () => {
    for (const r of ["already_enrolled", "missing_email", "unsubscribed", "bounced", "converted"]) {
      reason = r;
      await expect(run("lead"), r).resolves.toBe(0);
    }
  });

  it("⚠️⚠️ fails when the sequence cannot enroll anybody, so the log shows it", async () => {
    reason = "sequence_unavailable";
    await expect(run("lead")).rejects.toThrow(/cannot enroll/);
    reason = "no_steps";
    await expect(run("contact")).rejects.toThrow(/cannot enroll/);
  });

  it("refuses a record type sequences do not write to", async () => {
    await expect(run("deal")).rejects.toThrow(/leads and contacts/);
    expect(calls).toHaveLength(0);
  });
});

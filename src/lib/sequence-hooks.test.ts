/**
 * The four places a follow-up sequence is started, stopped or carried forward.
 *
 * ⚠️⚠️ Each of these is one line in a file that has nothing else to do with
 * sequences. Removing any of them breaks no other test and no screen: the
 * sequences simply keep writing — to somebody who replied, who unsubscribed, or
 * whose address bounces.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

describe("the email worker", () => {
  const src = read("src/app/api/cron/email-worker/route.ts");

  it("⚠️⚠️ advances the sequences, before claiming what to send", () => {
    const advance = src.indexOf("advanceSequences(db, now)");
    expect(advance, "sequences are never advanced").toBeGreaterThan(-1);
    expect(advance).toBeLessThan(src.indexOf("claimDueJobs(db, now, BATCH_SIZE)"));
  });

  it("⚠️ records the provider's message id, which is how a bounce finds its workspace", () => {
    expect(src).toContain("messageId: result.messageId ?? null");
  });
});

describe("an email arriving", () => {
  const src = read("src/lib/ticket-from-email.ts");

  it("⚠️⚠️ stops the sequences writing to its sender, before any early return", () => {
    const stop = src.indexOf("stopOnReply(db, senderEmail)");
    expect(stop, "a reply stops nothing").toBeGreaterThan(-1);
    expect(stop).toBeLessThan(src.indexOf('skipped: "empty_body"'));
  });
});

describe("a bounce or a complaint", () => {
  const src = read("src/app/api/webhooks/resend/route.ts");

  it("⚠️⚠️ is recognised for emails that are not part of a campaign", () => {
    expect(src).toContain("eq(emailJobs.messageId, messageId)");
  });

  it("⚠️ stops every sequence writing to that address", () => {
    expect(src.match(/stopForAddress\(db, email, "bounced"\)/g)?.length).toBe(2);
  });
});

describe("an unsubscribe", () => {
  const src = read("src/app/api/unsubscribe/route.ts");

  it("⚠️⚠️ understands the link a sequence email carries", () => {
    expect(src).toContain("logId.startsWith(SEQUENCE_TOKEN_PREFIX)");
    expect(src).toContain('await stopForAddress(sdb, email, "unsubscribed")');
  });

  it("⚠️ from a campaign also stops the sequences", () => {
    expect(src).toContain('stopForAddress(db, email, "unsubscribed")');
  });
});

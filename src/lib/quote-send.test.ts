/**
 * What emailing a quote means, decided before anything is sent.
 *
 * ⚠️⚠️ The send action mailed first and asked the state machine after: a follow-up on a
 * quote the customer had opened (`viewed`) reached them and then showed the salesperson an
 * error, and a draft over the approval threshold went out before being refused.
 */
import { describe, expect, it } from "vitest";

import { decideQuoteSend } from "./quote-status";

describe("⚠️⚠️ decideQuoteSend", () => {
  it("a draft or an approved quote is sent for the first time", () => {
    expect(decideQuoteSend("draft", null)).toEqual({ kind: "first" });
    expect(decideQuoteSend("approved", null)).toEqual({ kind: "first" });
  });

  it("a quote already sent, or already opened, is a reminder — the status does not move", () => {
    expect(decideQuoteSend("sent", null)).toEqual({ kind: "reminder" });
    expect(decideQuoteSend("viewed", null)).toEqual({ kind: "reminder" });
  });

  it("a draft over the approval policy is refused before anything leaves", () => {
    const d = decideQuoteSend("draft", "Discount above 20%.");
    expect(d.kind).toBe("refuse");
  });

  it("approval, once given, is not asked for again", () => {
    expect(decideQuoteSend("approved", "Discount above 20%.")).toEqual({ kind: "first" });
  });

  it("nothing that cannot become sent is emailed", () => {
    for (const status of ["pending_approval", "accepted", "declined", "expired", "converted"]) {
      expect(decideQuoteSend(status, null).kind).toBe("refuse");
    }
  });
});

/**
 * Paging a ticket's thread without losing any of it.
 *
 * ⚠️ The failure these guard against is quiet. A merge that drops the older pages
 * on refresh makes the conversation an agent was reading vanish from above the
 * reply they just sent. A summary read from one page instead of the whole thread
 * names the wrong opening message and undercounts the replies. Neither throws, and
 * both look like a normal screen.
 */
import { describe, expect, it } from "vitest";

import { handover } from "./ticket-handover";
import { HANDOVER_CONTENT_CAP, mergeThread, oldestOf, TICKET_THREAD_PAGE } from "./ticket-thread";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 9, minutes));
const msg = (id: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: at(minutes),
  ...extra,
});

describe("merging a fresh page into what the screen holds", () => {
  it("⚠️⚠️ keeps every older page the agent had opened", () => {
    // After a reply the screen reloads only the latest page. The older ones must
    // still be there above it.
    const held = [msg("old-1", 1), msg("old-2", 2), msg("recent", 50)];
    const fresh = [msg("recent", 50), msg("reply", 60)];

    expect(mergeThread(fresh, held).map((m) => m.id)).toEqual(["old-1", "old-2", "recent", "reply"]);
  });

  it("⚠️ lets the fresh page win for a message it also contains", () => {
    const held = [msg("m", 5, { content: "before" })];
    const fresh = [msg("m", 5, { content: "after" })];

    const merged = mergeThread(fresh, held);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ content: "after" });
  });

  it("puts everything oldest first, whatever order it arrived in", () => {
    // The server returns pages newest first; the timeline reads oldest first.
    const fresh = [msg("c", 30), msg("a", 10), msg("b", 20)];
    expect(mergeThread(fresh, []).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("accepts timestamps as they cross the wire", () => {
    const fresh = [{ id: "x", createdAt: at(2).toISOString() }];
    const held = [{ id: "y", createdAt: at(1).toISOString() }];
    expect(mergeThread(fresh, held).map((m) => m.id)).toEqual(["y", "x"]);
  });
});

describe("where the next older page ends", () => {
  it("is the oldest thing held across messages and audit entries together", () => {
    const messages = [msg("m1", 40), msg("m2", 45)];
    const audit = [msg("a1", 12), msg("a2", 50)];
    expect(oldestOf(messages, audit)?.toISOString()).toBe(at(12).toISOString());
  });

  it("is nowhere when nothing is held", () => {
    expect(oldestOf([], [])).toBeNull();
  });
});

describe("the summary a paged thread would get wrong", () => {
  // A ticket longer than one page, where the customer's opening question is only
  // in the part the first page does not carry.
  const thread = Array.from({ length: TICKET_THREAD_PAGE + 20 }, (_, i) => ({
    id: `m${i}`,
    senderId: i % 2 === 0 ? null : "agent-1",
    senderName: i % 2 === 0 ? "Customer" : "Agent",
    isPublic: true,
    content: i === 0 ? "My invoice is wrong" : `message ${i}`,
    createdAt: at(i),
  }));
  const latestPage = thread.slice(-TICKET_THREAD_PAGE);

  it("⚠️⚠️ names the real opening message only when it reads the whole thread", () => {
    // This is why the server computes the summary before cutting the page. From
    // the latest page alone the "opening" is some message from halfway through.
    expect(handover(thread).opening?.text).toBe("My invoice is wrong");
    expect(handover(latestPage).opening?.text).not.toBe("My invoice is wrong");
  });

  it("counts every reply only when it reads the whole thread", () => {
    expect(handover(thread).replies).toBeGreaterThan(handover(latestPage).replies);
  });

  it("reads enough of each message for the excerpt it shows", () => {
    // The card shows 160 characters, so the cap on what the summary reads must
    // stay above that or the excerpt itself would be cut short.
    expect(HANDOVER_CONTENT_CAP).toBeGreaterThanOrEqual(160);
  });
});

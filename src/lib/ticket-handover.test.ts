/**
 * The handover panel's arithmetic.
 *
 * On the tested surface because of what it is read for. Somebody scanning a
 * queue decides what to open next from one word of this — "waiting on us" or
 * "waiting on the customer" — and a wrong word sends them to the wrong ticket
 * while the right one ages. It never throws and never looks broken.
 */
import { describe, expect, it } from "vitest";

import { excerpt, type HandoverMessage, handover } from "./ticket-handover";

const NOW = new Date("2026-09-05T12:00:00Z").getTime();
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000);

let seq = 0;
const fromCustomer = (content: string, at: Date, isPublic = true): HandoverMessage => ({
  id: `c${seq++}`,
  senderId: null,
  senderName: "Rossi",
  isPublic,
  content,
  createdAt: at,
});
const fromUs = (content: string, at: Date, isPublic = true): HandoverMessage => ({
  id: `u${seq++}`,
  senderId: "agent-1",
  senderName: "Anna",
  isPublic,
  content,
  createdAt: at,
});

describe("whose move it is", () => {
  it("⚠️ waits on us when the customer spoke last", () => {
    const h = handover([fromUs("Have you tried…", hoursAgo(30)), fromCustomer("Yes, still broken", hoursAgo(4))], NOW);
    expect(h.waiting).toBe("us");
    expect(h.waitingHours).toBe(4);
  });

  it("⚠️ waits on the customer when we answered last", () => {
    const h = handover([fromCustomer("It is broken", hoursAgo(30)), fromUs("Try this", hoursAgo(4))], NOW);
    expect(h.waiting).toBe("customer");
  });

  it("⚠️ measures the wait from the last message, not from when it opened", () => {
    // A ticket open three weeks and answered an hour ago has not been ignored
    // for three weeks, and showing that number sends somebody to the wrong queue.
    const h = handover([fromCustomer("Opened long ago", hoursAgo(500)), fromCustomer("Any news?", hoursAgo(2))], NOW);
    expect(h.waitingHours).toBe(2);
  });

  it("⚠️ an internal note is not an answer to the customer", () => {
    // The note means somebody looked. It does not mean anybody replied, and
    // treating it as a reply hides a ticket nobody has answered.
    const h = handover(
      [fromCustomer("It is broken", hoursAgo(9)), fromUs("checked the logs", hoursAgo(1), false)],
      NOW,
    );
    expect(h.waiting).toBe("us");
    expect(h.neverAnswered).toBe(true);
    expect(h.replies).toBe(0);
  });

  it("waits on nobody when there is nothing public at all", () => {
    const h = handover([fromUs("opened on their behalf", hoursAgo(3), false)], NOW);
    expect(h.waiting).toBe("nobody");
    expect(h.waitingHours).toBeNull();
  });

  it("survives a ticket with no messages", () => {
    const h = handover([], NOW);
    expect(h.waiting).toBe("nobody");
    expect(h.opening).toBeNull();
    expect(h.lastWord).toBeNull();
    expect(h.publicMessages).toBe(0);
  });
});

describe("what it quotes", () => {
  it("quotes the customer's own words, not ours", () => {
    const h = handover(
      [fromUs("Thanks for getting in touch", hoursAgo(20)), fromCustomer("The printer jams", hoursAgo(19))],
      NOW,
    );
    expect(h.opening?.text).toBe("The printer jams");
  });

  it("falls back to the first message when nothing came from outside", () => {
    const h = handover([fromUs("Raised on the phone for Rossi", hoursAgo(5))], NOW);
    expect(h.opening?.text).toBe("Raised on the phone for Rossi");
  });

  it("carries the last word and says which side said it", () => {
    const h = handover([fromCustomer("Broken", hoursAgo(9)), fromUs("Fixed now", hoursAgo(1))], NOW);
    expect(h.lastWord?.text).toBe("Fixed now");
    expect(h.lastWord?.fromUs).toBe(true);
  });

  it("⚠️ keeps the internal note out of the public thread", () => {
    // The note is where "what was already tried" lives, and it must never be
    // offered as the last thing the customer was told.
    const h = handover([fromCustomer("Broken", hoursAgo(9)), fromUs("Replaced the drum", hoursAgo(2), false)], NOW);
    expect(h.lastWord?.text).toBe("Broken");
    expect(h.lastNote?.text).toBe("Replaced the drum");
    expect(h.internalNotes).toBe(1);
    expect(h.publicMessages).toBe(1);
  });
});

describe("reading a thread that arrives out of order", () => {
  it("⚠️ sorts before it decides, so the answer does not depend on the query", () => {
    const newest = fromCustomer("Still broken", hoursAgo(1));
    const oldest = fromUs("Try this", hoursAgo(10));
    expect(handover([newest, oldest], NOW).waiting).toBe("us");
    expect(handover([oldest, newest], NOW).waiting).toBe("us");
  });

  it("counts both sides of a longer conversation", () => {
    const h = handover(
      [
        fromCustomer("One", hoursAgo(10)),
        fromUs("Two", hoursAgo(9)),
        fromCustomer("Three", hoursAgo(8)),
        fromUs("Four", hoursAgo(7)),
        fromUs("note", hoursAgo(6), false),
      ],
      NOW,
    );
    expect(h.publicMessages).toBe(4);
    expect(h.replies).toBe(2);
    expect(h.internalNotes).toBe(1);
    expect(h.neverAnswered).toBe(false);
  });
});

describe("excerpt", () => {
  it("leaves a short message alone", () => {
    expect(excerpt("The printer jams")).toBe("The printer jams");
  });

  it("flattens the newlines an email arrives with", () => {
    expect(excerpt("Hello,\n\n   the printer jams.")).toBe("Hello, the printer jams.");
  });

  it("⚠️ cuts between words, not through one", () => {
    // A quotation stopping mid-word reads as damaged text, not as an excerpt.
    // The limit here lands inside "charlie" on purpose: a limit that happens to
    // fall on a space proves nothing, which is what the first version of this
    // test did — it passed with the word-boundary logic removed.
    expect(excerpt("alpha bravo charlie delta", 15)).toBe("alpha bravo…");
  });

  it("still cuts when a single word is longer than the limit", () => {
    const cut = excerpt("a".repeat(300), 50);
    expect(cut.length).toBe(51);
  });
});

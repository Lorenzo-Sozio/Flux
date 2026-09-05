/**
 * The credential inside a calendar subscription URL.
 *
 * On the tested surface for the same reason as the import API and the RSVP link:
 * this token decides which customer's database is opened and whose appointments
 * come back. A mistake does not look like a failure. It looks like a calendar,
 * full of meetings, belonging to somebody else.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { signCalendarFeedToken, verifyCalendarFeedToken } from "./calendar-feed-token";

const ALICE = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const BOB = { tenantId: "22222222-2222-4222-8222-222222222222", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };

beforeAll(() => {
  process.env.CALENDAR_FEED_SECRET = "test-secret-not-a-real-one";
});

describe("signCalendarFeedToken", () => {
  it("round-trips the identity it was given", () => {
    expect(verifyCalendarFeedToken(signCalendarFeedToken(ALICE))).toEqual(ALICE);
  });

  it("gives two people different tokens", () => {
    expect(signCalendarFeedToken(ALICE)).not.toBe(signCalendarFeedToken(BOB));
  });

  it("is stable, so a subscription keeps working", () => {
    // A token that changed on each call would leave every calendar client
    // subscribed to a URL that had already stopped working.
    expect(signCalendarFeedToken(ALICE)).toBe(signCalendarFeedToken(ALICE));
  });

  it("survives a URL without being escaped", () => {
    expect(signCalendarFeedToken(ALICE)).toBe(encodeURIComponent(signCalendarFeedToken(ALICE)));
  });
});

describe("verifyCalendarFeedToken", () => {
  it("⚠️ refuses a token whose workspace was edited", () => {
    // The whole point: swapping the workspace in the URL must not hand back
    // another customer's appointments.
    const forged = `${Buffer.from(`${BOB.tenantId}:${ALICE.userId}`, "utf8").toString("base64url")}.${
      signCalendarFeedToken(ALICE).split(".")[1]
    }`;
    expect(verifyCalendarFeedToken(forged)).toBeNull();
  });

  it("⚠️ refuses a token whose person was edited", () => {
    const forged = `${Buffer.from(`${ALICE.tenantId}:${BOB.userId}`, "utf8").toString("base64url")}.${
      signCalendarFeedToken(ALICE).split(".")[1]
    }`;
    expect(verifyCalendarFeedToken(forged)).toBeNull();
  });

  it("⚠️ refuses an unsigned token", () => {
    const body = Buffer.from(`${ALICE.tenantId}:${ALICE.userId}`, "utf8").toString("base64url");
    expect(verifyCalendarFeedToken(body)).toBeNull();
    expect(verifyCalendarFeedToken(`${body}.`)).toBeNull();
  });

  it("refuses a signature from a different key", () => {
    const mine = signCalendarFeedToken(ALICE);
    process.env.CALENDAR_FEED_SECRET = "a-different-secret";
    const theirs = verifyCalendarFeedToken(mine);
    process.env.CALENDAR_FEED_SECRET = "test-secret-not-a-real-one";
    expect(theirs).toBeNull();
  });

  it("refuses a truncated signature rather than comparing a prefix", () => {
    const [body, sig] = signCalendarFeedToken(ALICE).split(".");
    expect(verifyCalendarFeedToken(`${body}.${sig.slice(0, 10)}`)).toBeNull();
  });

  it("refuses rubbish without throwing", () => {
    for (const bad of ["", ".", "..", "not-a-token", "a.b.c", "%%%.%%%", "null", "../../etc/passwd"]) {
      expect(verifyCalendarFeedToken(bad), bad).toBeNull();
    }
  });

  it("refuses a payload that is not an identity", () => {
    const body = Buffer.from("just-one-field", "utf8").toString("base64url");
    expect(verifyCalendarFeedToken(body)).toBeNull();
  });

  it("⚠️ refuses a token signed for an incomplete identity", () => {
    // Not an attack — a caller passing an empty id, which a session bug can do.
    // The signature would be perfectly valid, so nothing downstream would query
    // it: the route would open the workspace and ask for the appointments of
    // user "", which is every appointment with no organiser.
    for (const broken of [
      { tenantId: ALICE.tenantId, userId: "" },
      { tenantId: "", userId: ALICE.userId },
      { tenantId: "", userId: "" },
    ]) {
      expect(verifyCalendarFeedToken(signCalendarFeedToken(broken)), JSON.stringify(broken)).toBeNull();
    }
  });

  it("⚠️ tells one identity from another, and does not confuse them", () => {
    expect(verifyCalendarFeedToken(signCalendarFeedToken(BOB))).toEqual(BOB);
    expect(verifyCalendarFeedToken(signCalendarFeedToken(ALICE))).not.toEqual(BOB);
  });
});

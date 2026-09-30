import { describe, expect, it } from "vitest";

import { dayBucket, relativeTime } from "./relative-time";

const NOW = new Date(2026, 8, 30, 10, 0, 0);

describe("how long ago, in the reader's words", () => {
  it("says minutes, then hours, then days", () => {
    expect(relativeTime(NOW.getTime() - 3 * 60_000, "it", NOW.getTime())).toBe("3 minuti fa");
    expect(relativeTime(NOW.getTime() - 2 * 3_600_000, "en", NOW.getTime())).toBe("2 hours ago");
    expect(relativeTime(NOW.getTime() - 26 * 3_600_000, "it", NOW.getTime())).toBe("ieri");
    // A date as the server sends it.
    expect(relativeTime(new Date(NOW.getTime() - 60_000).toISOString(), "en", NOW.getTime())).toBe("1 minute ago");
  });
});

describe("the day a notification goes under", () => {
  it("is by calendar day, not by 24-hour slices", () => {
    // Five minutes after midnight is today; five minutes before is yesterday, though both are minutes ago.
    const midnight = new Date(2026, 8, 30, 0, 0, 0);
    expect(dayBucket(new Date(midnight.getTime() + 5 * 60_000), NOW)).toBe("today");
    expect(dayBucket(new Date(midnight.getTime() - 5 * 60_000), NOW)).toBe("yesterday");
    expect(dayBucket(new Date(2026, 8, 25, 12), NOW)).toBe("week");
    expect(dayBucket(new Date(2026, 8, 20, 12), NOW)).toBe("older");
  });
});

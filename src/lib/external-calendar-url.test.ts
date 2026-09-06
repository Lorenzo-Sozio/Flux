/**
 * Deciding whether an address the server is about to fetch is safe.
 *
 * On the tested surface because of what it is: a request our server makes to a
 * host somebody else chose. Point it at something only the server can reach and
 * the answer comes back to them — and the address that matters most looks the
 * most harmless, because 169.254.169.254 is where cloud providers keep the
 * credentials of the machine.
 */
import { describe, expect, it } from "vitest";

import { checkExternalCalendarUrl } from "./external-calendar-url";

const ok = (raw: string, origin?: string) => checkExternalCalendarUrl(raw, origin);
const refusedFor = (raw: string, origin?: string) => {
  const v = checkExternalCalendarUrl(raw, origin);
  return v.ok ? null : v.reason;
};

describe("addresses it accepts", () => {
  it("takes an ordinary published calendar", () => {
    const v = ok("https://calendar.google.com/calendar/ical/abc/basic.ics");
    expect(v.ok && v.url).toBe("https://calendar.google.com/calendar/ical/abc/basic.ics");
  });

  it("⚠️ accepts webcal:// by turning it into https", () => {
    // Every calendar client hands the address out with that scheme, so refusing
    // it would refuse the exact string people are given to copy.
    const v = ok("webcal://p01.calendar.icloud.com/published/2/abc");
    expect(v.ok && v.url.startsWith("https://")).toBe(true);
  });

  it("keeps the query string, which is often where the secret lives", () => {
    const v = ok("https://outlook.office365.com/owa/calendar/x/reachcalendar.ics?token=s3cr3t");
    expect(v.ok && v.url).toContain("token=s3cr3t");
  });

  it("tolerates surrounding whitespace from a paste", () => {
    expect(ok("  https://example.com/a.ics  ").ok).toBe(true);
  });
});

describe("addresses it refuses", () => {
  it("says so when nothing was pasted", () => {
    expect(refusedFor("")).toBe("empty");
    expect(refusedFor("   ")).toBe("empty");
  });

  it("refuses something that is not an address at all", () => {
    expect(refusedFor("my calendar")).toBe("not-a-url");
  });

  it("⚠️ refuses a scheme that is not http", () => {
    // `file://` would read the server's own disk and hand it back.
    for (const raw of ["file:///etc/passwd", "ftp://example.com/a.ics", "data:text/calendar,BEGIN"]) {
      expect(refusedFor(raw), raw).toBe("scheme");
    }
  });

  it("⚠️⚠️ refuses the cloud metadata service and every private range", () => {
    // 169.254.169.254 is the one that costs the most: a successful fetch of it
    // returns the machine's own credentials.
    for (const host of [
      "169.254.169.254",
      "127.0.0.1",
      "localhost",
      "10.0.0.5",
      "192.168.1.10",
      "172.16.4.4",
      "172.31.255.1",
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      expect(refusedFor(`http://${host}/a.ics`), host).toBe("private-host");
    }
  });

  it("⚠️ refuses the IPv6 spellings of the same places", () => {
    // fc00::/7 is one range written two ways — fc… and fd… — and a check that
    // only knows the second half leaves the first wide open.
    for (const host of ["[::1]", "[::]", "[fc00::1]", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]"]) {
      expect(refusedFor(`http://${host}/a.ics`), host).toBe("private-host");
    }
  });

  it("⚠️ refuses a bare hostname with no dot", () => {
    // `http://intranet/…` resolves inside most networks and nowhere outside one.
    expect(refusedFor("http://intranet/calendar.ics")).toBe("private-host");
  });

  it("⚠️ refuses our own feed, which would show every appointment twice", () => {
    // Nothing fails if this gets through: the week simply looks twice as busy,
    // and the second copy cannot be edited because it is not a record.
    expect(refusedFor("https://app.fluxcrm.com/api/calendar/abc.def", "https://app.fluxcrm.com")).toBe("our-own-feed");
  });

  it("does not refuse another page on our own domain", () => {
    // Only the feed itself loops. Refusing the whole origin would be a rule
    // wider than its reason.
    expect(ok("https://app.fluxcrm.com/some/other.ics", "https://app.fluxcrm.com").ok).toBe(true);
  });

  it("survives a misconfigured origin instead of refusing the user", () => {
    expect(ok("https://calendar.google.com/a.ics", "not a url").ok).toBe(true);
  });
});

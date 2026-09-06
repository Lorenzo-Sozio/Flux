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

import { checkExternalCalendarUrl, fetchWithCheckedRedirects, MAX_REDIRECTS } from "./external-calendar-url";

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

/**
 * ⚠️⚠️ The redirect walk.
 *
 * Checking the address a person saved and then handing it to
 * `fetch(url, { redirect: "follow" })` is not a check: the far end decides the
 * second request, and every guard above is bypassed by one `Location` header.
 * These tests are the ones that would have caught it.
 */
describe("where a calendar address is allowed to send us", () => {
  /** A fake far end: a script of responses, and a log of what was asked for. */
  function server(script: Record<string, { status: number; location?: string }>) {
    const asked: string[] = [];
    const request = async (url: string) => {
      asked.push(url);
      const step = script[url] ?? { status: 404 };
      return new Response(null, {
        status: step.status,
        headers: step.location ? { location: step.location } : undefined,
      });
    };
    return { asked, request };
  }

  it("returns the first response when there is no redirect", async () => {
    const { asked, request } = server({ "https://cal.example.com/a.ics": { status: 200 } });
    const response = await fetchWithCheckedRedirects("https://cal.example.com/a.ics", request);

    expect(response?.status).toBe(200);
    expect(asked).toEqual(["https://cal.example.com/a.ics"]);
  });

  it("⚠️⚠️ refuses to be redirected to the instance metadata service", async () => {
    // The whole reason this walk exists. 169.254.169.254 answers on every major
    // cloud and hands over credentials to anything that asks from inside.
    const { asked, request } = server({
      "https://cal.example.com/a.ics": { status: 302, location: "http://169.254.169.254/latest/meta-data/" },
    });
    const response = await fetchWithCheckedRedirects("https://cal.example.com/a.ics", request);

    expect(response).toBeNull();
    // And it was never asked for: refused before the request, not after.
    expect(asked).not.toContain("http://169.254.169.254/latest/meta-data/");
  });

  it("⚠️ refuses a redirect to localhost and to a private range", async () => {
    for (const target of ["http://localhost:8080/x.ics", "http://10.0.0.5/x.ics", "http://[::1]/x.ics"]) {
      const { request } = server({ "https://cal.example.com/a.ics": { status: 302, location: target } });
      expect(await fetchWithCheckedRedirects("https://cal.example.com/a.ics", request)).toBeNull();
    }
  });

  it("follows a redirect that lands somewhere public", async () => {
    // Calendar providers redirect constantly; refusing every hop would refuse
    // most real addresses.
    const { asked, request } = server({
      "https://cal.example.com/a.ics": { status: 301, location: "https://files.example.net/a.ics" },
      "https://files.example.net/a.ics": { status: 200 },
    });
    const response = await fetchWithCheckedRedirects("https://cal.example.com/a.ics", request);

    expect(response?.status).toBe(200);
    expect(asked).toEqual(["https://cal.example.com/a.ics", "https://files.example.net/a.ics"]);
  });

  it("resolves a relative Location against the hop it is on, not the address saved", async () => {
    const { asked, request } = server({
      "https://a.example.com/one.ics": { status: 302, location: "https://b.example.com/deep/two.ics" },
      "https://b.example.com/deep/two.ics": { status: 302, location: "three.ics" },
      "https://b.example.com/deep/three.ics": { status: 200 },
    });
    const response = await fetchWithCheckedRedirects("https://a.example.com/one.ics", request);

    expect(response?.status).toBe(200);
    expect(asked.at(-1)).toBe("https://b.example.com/deep/three.ics");
  });

  it("⚠️ gives up rather than walk a redirect loop for ever", async () => {
    const { asked, request } = server({
      "https://a.example.com/x.ics": { status: 302, location: "https://b.example.com/x.ics" },
      "https://b.example.com/x.ics": { status: 302, location: "https://a.example.com/x.ics" },
    });
    const response = await fetchWithCheckedRedirects("https://a.example.com/x.ics", request);

    expect(response).toBeNull();
    expect(asked.length).toBeLessThanOrEqual(MAX_REDIRECTS + 1);
  });

  it("treats a 3xx with no Location as the answer, not as a redirect", async () => {
    const { request } = server({ "https://cal.example.com/a.ics": { status: 304 } });
    const response = await fetchWithCheckedRedirects("https://cal.example.com/a.ics", request);

    expect(response?.status).toBe(304);
  });

  it("refuses a redirect to a scheme that is not http", async () => {
    // `file:///etc/passwd` is the other half of the same trick.
    const { request } = server({
      "https://cal.example.com/a.ics": { status: 302, location: "file:///etc/passwd" },
    });
    expect(await fetchWithCheckedRedirects("https://cal.example.com/a.ics", request)).toBeNull();
  });
});

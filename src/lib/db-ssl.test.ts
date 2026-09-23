/**
 * Which server a connection string means, and how its certificate is checked.
 *
 * Both answers here are security decisions written as string tests, which is exactly
 * the shape of code that looks right and is not: a prefix or a substring where a whole
 * name was meant. Getting `isNeonUrl` wrong sends the password to somebody else's
 * HTTP endpoint; getting the loopback test wrong turns TLS **off** for a host on the
 * open internet, because "this is local" is what turns it off.
 */
import { describe, expect, it } from "vitest";

import { isNeonUrl, sslFor } from "./db-ssl";

const neon = "postgresql://owner:secret@ep-example.eu-central-1.aws.neon.tech/workspace?sslmode=require";
const railway = "postgresql://postgres:secret@iriguchi.proxy.rlwy.net:37180/railway";

describe("which driver a connection string means", () => {
  it("recognises Neon, whatever the region and the parameters", () => {
    expect(isNeonUrl(neon)).toBe(true);
    expect(isNeonUrl("postgres://u:p@ep-x.neon.tech:5432/db")).toBe(true);
  });

  it("⚠️⚠️ is not fooled by a domain that merely contains the name", () => {
    // Anybody can register these. Treating one as Neon would send the credentials
    // to an HTTP endpoint of their choosing.
    expect(isNeonUrl("postgresql://u:p@neon.tech.attacker.example/db")).toBe(false);
    expect(isNeonUrl("postgresql://u:p@myneon.tech/db")).toBe(false);
    expect(isNeonUrl("postgresql://u:p@ep-x.neon.tech.evil.net:5432/db")).toBe(false);
    expect(isNeonUrl(railway)).toBe(false);
  });
});

describe("how the certificate is checked", () => {
  it("pins a CA for a remote host, and verifies against it", () => {
    const ssl = sslFor(railway);
    expect(ssl?.rejectUnauthorized).toBe(true);
    expect(ssl?.ca).toContain("BEGIN CERTIFICATE");
  });

  it("⚠️⚠️ only a real loopback name skips TLS, never a name that starts with one", () => {
    // `localhost.attacker.example` resolves to whatever its owner says. Accepting it
    // as local would open an unencrypted connection across the internet.
    for (const host of ["localhost.attacker.example", "127.0.0.1.attacker.example", "notlocalhost"]) {
      expect(sslFor(`postgresql://u:p@${host}:5432/db`), host).toBeDefined();
    }
    for (const host of ["localhost", "localhost:5432", "127.0.0.1:5432", "db.localhost:5432"]) {
      expect(sslFor(`postgresql://u:p@${host}/db`), host).toBeUndefined();
    }
  });

  it("⚠️ keeps the pinned CA when the connection string cannot be read", () => {
    // Failing to parse is not a reason to connect without checking anything.
    expect(sslFor("not a url at all")).toBeDefined();
  });

  it("takes a replacement CA from the environment, for the day a provider rotates one", () => {
    const original = process.env.DATABASE_CA_PEM;
    process.env.DATABASE_CA_PEM = "-----BEGIN CERTIFICATE-----\nrotated\n-----END CERTIFICATE-----";
    try {
      expect(sslFor(railway)?.ca).toContain("rotated");
    } finally {
      if (original === undefined) delete process.env.DATABASE_CA_PEM;
      else process.env.DATABASE_CA_PEM = original;
    }
  });
});

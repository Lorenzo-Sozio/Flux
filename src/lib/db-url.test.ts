/**
 * Reading a connection string well enough to refuse one.
 *
 * `sameDatabase` decides whether a workspace may be pointed at a database, and a wrong
 * "no" is an inconvenience while a wrong "yes" runs the tenant migrations over the
 * registry that holds every workspace's connection string.
 */
import { describe, expect, it } from "vitest";

import { parseDbUrl, redactDbUrl, sameDatabase } from "./db-url";

const platform = "postgresql://postgres:secret@iriguchi.proxy.rlwy.net:37180/railway";

describe("reading a connection string", () => {
  it("takes host, port and database, with 5432 as the default port", () => {
    expect(parseDbUrl(platform)).toEqual({ host: "iriguchi.proxy.rlwy.net", port: 37180, database: "railway" });
    expect(parseDbUrl("postgres://u:p@db.example/flux")).toEqual({ host: "db.example", port: 5432, database: "flux" });
    expect(parseDbUrl("postgresql://u:p@[::1]:5433/flux")).toEqual({ host: "::1", port: 5433, database: "flux" });
  });

  it("ignores the parameters after the database name", () => {
    expect(parseDbUrl("postgresql://u:p@h/flux?sslmode=require")?.database).toBe("flux");
  });

  it("says nothing for something that is not a connection string", () => {
    expect(parseDbUrl("not a url")).toBeNull();
    expect(parseDbUrl("")).toBeNull();
    expect(parseDbUrl(null)).toBeNull();
  });
});

describe("whether two strings mean the same database", () => {
  it("⚠️⚠️ recognises the platform database however it is written", () => {
    expect(sameDatabase(platform, platform)).toBe(true);
    expect(sameDatabase("postgresql://other:pass@IRIGUCHI.proxy.rlwy.net:37180/railway/", platform)).toBe(true);
    expect(sameDatabase("postgresql://u:p@iriguchi.proxy.rlwy.net:37180/railway?sslmode=require", platform)).toBe(true);
  });

  it("tells a different database on the same server apart", () => {
    expect(sameDatabase("postgresql://postgres:secret@iriguchi.proxy.rlwy.net:37180/flux_demo", platform)).toBe(false);
  });

  it("tells the same name on a different server apart", () => {
    expect(sameDatabase("postgresql://postgres:secret@other.host:37180/railway", platform)).toBe(false);
    expect(sameDatabase("postgresql://postgres:secret@iriguchi.proxy.rlwy.net:5432/railway", platform)).toBe(false);
  });

  it("⚠️⚠️ answers 'the same' when it cannot tell, because the question is a permission", () => {
    expect(sameDatabase("gibberish", platform)).toBe(true);
    expect(sameDatabase(platform, undefined)).toBe(true);
  });
});

describe("showing a connection string to a person", () => {
  it("keeps the password out of it", () => {
    expect(redactDbUrl(platform)).toBe("postgresql://postgres:***@iriguchi.proxy.rlwy.net:37180/railway");
  });
});

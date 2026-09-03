/**
 * Storage keys.
 *
 * On the tested boundary because the filename is attacker-controlled and reaches
 * a path. A key built from it turns "upload a file" into "write anywhere the
 * process can write", and the failure looks like a successful upload.
 */
import { describe, expect, it } from "vitest";

import { contentHash, isValidStorageKey, newStorageKey } from "./storage";

describe("newStorageKey", () => {
  it("keeps nothing from the filename but the extension", () => {
    const key = newStorageKey("Q3 report FINAL (2).pdf");
    expect(key).not.toContain("report");
    expect(key).not.toContain(" ");
    expect(key.endsWith(".pdf")).toBe(true);
    expect(isValidStorageKey(key)).toBe(true);
  });

  it("refuses to carry a traversal attempt into the path", () => {
    for (const name of ["../../etc/passwd", "..\\..\\windows\\system32\\a.dll", "a/../../b.pdf", "....//x.pdf"]) {
      const key = newStorageKey(name);
      expect(key).not.toContain("..");
      expect(isValidStorageKey(key)).toBe(true);
    }
  });

  it("drops an extension that is not one", () => {
    // "file.tar.gz.exe.a-very-long-thing" and friends must not become a suffix.
    expect(isValidStorageKey(newStorageKey("archive.averylongextension"))).toBe(true);
    expect(newStorageKey("archive.averylongextension").endsWith(".averylongextension")).toBe(false);
  });

  it("copes with no extension at all", () => {
    const key = newStorageKey("Makefile");
    expect(isValidStorageKey(key)).toBe(true);
  });

  it("never repeats a key", () => {
    const keys = new Set(Array.from({ length: 500 }, () => newStorageKey("a.pdf")));
    expect(keys.size).toBe(500);
  });

  it("groups by month, so a bucket listing stays navigable", () => {
    expect(newStorageKey("a.pdf")).toMatch(/^documents\/\d{6}\//);
  });
});

describe("isValidStorageKey", () => {
  it("accepts only what newStorageKey produces", () => {
    expect(isValidStorageKey(newStorageKey("a.pdf"))).toBe(true);
  });

  it("rejects anything that reaches outside the prefix", () => {
    // The read path checks this before touching the store, so a key that was
    // tampered with in the database still cannot address another object.
    for (const bad of [
      "documents/../secrets/key.pem",
      "../documents/202609/x.pdf",
      "documents/202609/../../x.pdf",
      "uploads/202609/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf",
      "documents/202609/not-a-uuid.pdf",
      "documents/20269/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf",
      "",
    ]) {
      expect(isValidStorageKey(bad), bad).toBe(false);
    }
  });
});

describe("contentHash", () => {
  it("is stable for the same bytes", () => {
    const a = new TextEncoder().encode("hello");
    expect(contentHash(a)).toBe(contentHash(new TextEncoder().encode("hello")));
  });

  it("differs for different bytes", () => {
    expect(contentHash(new TextEncoder().encode("a"))).not.toBe(contentHash(new TextEncoder().encode("b")));
  });
});

/**
 * The pieces the bulk import is built from.
 *
 * `claimTracker` is the interesting one: it holds the property the three-pass
 * rewrite could silently have lost, which is that a row this batch is *going* to
 * create counts as existing for the rows after it.
 */
import { describe, expect, it } from "vitest";

import { chunk, claimTracker, INSERT_CHUNK, LOOKUP_CHUNK } from "./api-import-batch";

describe("chunk", () => {
  it("preserves order and loses nothing", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2).flat()).toEqual([1, 2, 3, 4]);
  });

  it("handles the empty case and the exact fit", () => {
    expect(chunk([], 10)).toEqual([]);
    expect(chunk([1, 2], 2)).toEqual([[1, 2]]);
    expect(chunk([1], 10)).toEqual([[1]]);
  });

  it("⚠️ refuses a size of zero rather than looping for ever", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
  });

  it("keeps a full batch under the statement limits it was sized for", () => {
    const batch = Array.from({ length: 500 }, (_, i) => i);
    expect(chunk(batch, INSERT_CHUNK).length).toBeLessThanOrEqual(3);
    expect(chunk(batch, LOOKUP_CHUNK)).toHaveLength(1);
  });
});

describe("claimTracker", () => {
  it("finds what the workspace already held", () => {
    const taken = claimTracker([["known@x.it", "id-1"]]);
    expect(taken.find("known@x.it")).toBe("id-1");
    expect(taken.find("other@x.it")).toBeUndefined();
  });

  it("⚠️⚠️ counts a row this batch has not written yet", () => {
    // The whole reason it exists. One lookup for the whole batch cannot see the
    // rows the batch is about to create, so they are claimed as they are decided.
    const taken = claimTracker([]);
    expect(taken.find("new@x.it")).toBeUndefined();

    taken.claim("new@x.it", "about-to-exist");

    expect(taken.find("new@x.it")).toBe("about-to-exist");
  });

  it("⚠️ treats a missing value as nothing to match, not as a key", () => {
    // Two contacts with no email are two contacts. Letting null or undefined
    // become a map key makes the second one a duplicate of the first.
    const taken = claimTracker([]);
    taken.claim(null, "id-1");
    taken.claim(undefined, "id-2");
    taken.claim("", "id-3");

    expect(taken.find(null)).toBeUndefined();
    expect(taken.find(undefined)).toBeUndefined();
    expect(taken.find("")).toBeUndefined();
  });

  it("does not reach through to anything the map inherits", () => {
    // `Map` rather than a plain object, so an address spelled like a property of
    // Object.prototype is an ordinary miss.
    const taken = claimTracker([]);
    expect(taken.find("constructor")).toBeUndefined();
    expect(taken.find("__proto__")).toBeUndefined();
  });
});

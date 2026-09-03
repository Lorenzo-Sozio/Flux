/**
 * List paging, sorting and search as URL state.
 *
 * Worth testing because the failure is quiet in both directions: an off-by-one in
 * the offset silently skips or repeats a record, and a page beyond the end shows
 * an empty list that looks like "no results" rather than "you went too far".
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE, listHref, offsetOf, parseListParams, toPage } from "./pagination";

describe("parseListParams", () => {
  it("falls back to a sane first page", () => {
    const p = parseListParams({});
    expect(p).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, search: "", sort: null, dir: "desc", filter: null });
  });

  it("reads what the URL says", () => {
    const p = parseListParams({ page: "3", size: "25", q: " rossi ", sort: "lastName", dir: "asc", filter: "abc" });
    expect(p).toEqual({ page: 3, pageSize: 25, search: "rossi", sort: "lastName", dir: "asc", filter: "abc" });
  });

  it("refuses a page size that would defeat the point", () => {
    // A hand-edited `size=100000` is the unbounded query coming back.
    expect(parseListParams({ size: "100000" }).pageSize).toBe(200);
    // Nonsense falls back to the default rather than to a one-row page, which
    // would look like the list is broken.
    expect(parseListParams({ size: "0" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parseListParams({ size: "-5" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("refuses a page before the first", () => {
    expect(parseListParams({ page: "0" }).page).toBe(1);
    expect(parseListParams({ page: "-2" }).page).toBe(1);
  });

  it("survives nonsense instead of producing NaN", () => {
    // NaN reaches the database as `OFFSET NaN`, which is a syntax error on a page
    // the user reached by mistyping a URL.
    const p = parseListParams({ page: "abc", size: "xyz" });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseListParams({ page: ["2", "9"] }).page).toBe(2);
  });

  it("treats any direction other than asc as descending", () => {
    expect(parseListParams({ dir: "asc" }).dir).toBe("asc");
    expect(parseListParams({ dir: "sideways" }).dir).toBe("desc");
  });
});

describe("offsetOf", () => {
  it("starts the first page at zero", () => {
    expect(offsetOf(parseListParams({ page: "1", size: "50" }))).toBe(0);
  });

  it("skips exactly the pages before it", () => {
    expect(offsetOf(parseListParams({ page: "2", size: "50" }))).toBe(50);
    expect(offsetOf(parseListParams({ page: "4", size: "25" }))).toBe(75);
  });
});

describe("toPage", () => {
  it("reports how many pages there are", () => {
    expect(toPage([], 100, parseListParams({ size: "25" })).pageCount).toBe(4);
    expect(toPage([], 101, parseListParams({ size: "25" })).pageCount).toBe(5);
  });

  it("keeps one page when there is nothing", () => {
    // Zero pages would render "page 1 of 0".
    expect(toPage([], 0, parseListParams({})).pageCount).toBe(1);
  });

  it("clamps a page past the end back onto the last one", () => {
    // Deleting the only record on page 9 must not leave the reader stranded.
    const p = toPage([], 30, parseListParams({ page: "9", size: "25" }));
    expect(p.page).toBe(2);
    expect(p.pageCount).toBe(2);
  });
});

describe("listHref", () => {
  it("leaves a plain list plain", () => {
    expect(listHref("/dashboard/contacts", { page: 1, pageSize: DEFAULT_PAGE_SIZE })).toBe("/dashboard/contacts");
  });

  it("carries only what differs from the default", () => {
    expect(listHref("/dashboard/contacts", { page: 3 })).toBe("/dashboard/contacts?page=3");
    expect(listHref("/dashboard/contacts", { search: "rossi" })).toBe("/dashboard/contacts?q=rossi");
    expect(listHref("/dashboard/contacts", { sort: "lastName", dir: "desc" })).toBe(
      "/dashboard/contacts?sort=lastName",
    );
    expect(listHref("/dashboard/contacts", { sort: "lastName", dir: "asc" })).toBe(
      "/dashboard/contacts?sort=lastName&dir=asc",
    );
  });

  it("round-trips through parseListParams", () => {
    const original = parseListParams({ page: "3", size: "25", q: "rossi", sort: "lastName", dir: "asc" });
    const url = new URL(listHref("/x", original), "https://example.test");
    const parsed = parseListParams(Object.fromEntries(url.searchParams));
    expect(parsed).toEqual(original);
  });
});

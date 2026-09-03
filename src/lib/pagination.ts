/**
 * pagination.ts — the shape of a list request and its answer.
 *
 * Contacts, leads and companies each selected every column of every row and
 * handed the result to a client component. No limit, no paging, no server-side
 * sort, and no plain search box: the only way to narrow a list was the filter
 * builder (audit rilievi B-08, U-04).
 *
 * At a few thousand records that is megabytes of serialised JSON on every visit
 * to the three most-used screens in the product; at a few tens of thousands the
 * page does not open. Nothing about it degrades gradually — it works in a demo
 * and fails at the first real customer.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const MAX_PAGE_SIZE = 200;

export interface ListParams {
  /** 1-based, because that is what the URL shows the reader. */
  page: number;
  pageSize: number;
  /** Free-text search across the columns a person would type into. */
  search: string;
  /** Field key to sort on; the caller maps it to a column. */
  sort: string | null;
  dir: "asc" | "desc";
  /** The encoded filter tree, untouched. */
  filter: string | null;
}

export interface Page<T> {
  rows: T[];
  /** Rows matching the query, not rows returned. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Reads list state out of the URL.
 *
 * The URL is the state on purpose: a filtered, sorted, paged list stays
 * shareable and survives the back button, which a component's useState does not.
 */
export function parseListParams(params: Record<string, string | string[] | undefined>): ListParams {
  const one = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  // `parseInt` gives NaN for anything unparseable, and NaN reaches the database as
  // `OFFSET NaN` — a syntax error on a page somebody reached by mistyping a URL.
  const asPositiveInt = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const page = asPositiveInt(one("page"), 1);
  const rawSize = asPositiveInt(one("size"), DEFAULT_PAGE_SIZE);

  return {
    page,
    // A hand-edited `size=100000` is the unbounded query coming back in disguise.
    pageSize: Math.min(rawSize, MAX_PAGE_SIZE),
    search: (one("q") ?? "").trim(),
    sort: one("sort") ?? null,
    dir: one("dir") === "asc" ? "asc" : "desc",
    filter: one("filter") ?? null,
  };
}

/** Assembles a page, clamping the requested page to what actually exists. */
export function toPage<T>(rows: T[], total: number, params: ListParams): Page<T> {
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));
  return {
    rows,
    total,
    page: Math.min(params.page, pageCount),
    pageSize: params.pageSize,
    pageCount,
  };
}

/** Rows to skip for the requested page. */
export function offsetOf(params: ListParams): number {
  return (params.page - 1) * params.pageSize;
}

/**
 * Builds the query string for a list URL, dropping anything at its default so
 * the address stays readable.
 */
export function listHref(basePath: string, params: Partial<ListParams>): string {
  const q = new URLSearchParams();

  if (params.filter) q.set("filter", params.filter);
  if (params.search) q.set("q", params.search);
  if (params.sort) {
    q.set("sort", params.sort);
    if (params.dir === "asc") q.set("dir", "asc");
  }
  if (params.pageSize && params.pageSize !== DEFAULT_PAGE_SIZE) q.set("size", String(params.pageSize));
  if (params.page && params.page > 1) q.set("page", String(params.page));

  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

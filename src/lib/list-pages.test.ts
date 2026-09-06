/**
 * Keeps the list screens bounded.
 *
 * The defect this guards has now been found five times in the same product: a
 * screen that reads every row a workspace owns and narrows them in the browser.
 * It never looks broken. It looks like a page that takes a while, on somebody
 * else's machine, with somebody else's data — and the search box is unusable
 * until the whole history has arrived, which is exactly when a person needs it.
 *
 * Leads, contacts and companies were the first three. The deal page was the
 * fourth, loading every company and every contact to fill two dropdowns. Quotes
 * and orders were the fifth and sixth, and quotes carried every line item of
 * every quote with it.
 *
 * These checks are structural. They cannot tell whether a page is *fast* — only
 * whether the query behind it still has a limit on it and the screen still has
 * the controls to move through the pages. That is the part that gets undone by
 * accident, when somebody needs "just the whole list" for one feature and
 * changes the call the whole screen shares.
 */
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

const DASHBOARD = "src/app/(main)/dashboard";

/** Every list screen that pages on the server, and the action that feeds it. */
const PAGED_LISTS = [
  { name: "leads", page: `${DASHBOARD}/leads/page.tsx`, action: "listLeads", file: "src/actions/crm.ts" },
  { name: "contacts", page: `${DASHBOARD}/contacts/page.tsx`, action: "listContacts", file: "src/actions/crm.ts" },
  { name: "companies", page: `${DASHBOARD}/companies/page.tsx`, action: "listCompanies", file: "src/actions/crm.ts" },
  {
    name: "quotes",
    page: `${DASHBOARD}/sales/quotes/page.tsx`,
    action: "listQuotes",
    file: "src/actions/quotes.ts",
  },
  {
    name: "orders",
    page: `${DASHBOARD}/sales/orders/page.tsx`,
    action: "listOrders",
    file: "src/actions/orders.ts",
  },
] as const;

/** The body of one exported action, up to the next top-level export. */
function bodyOf(file: string, action: string): string {
  const src = read(file);
  const start = src.indexOf(`export async function ${action}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

describe.each(PAGED_LISTS)("the $name list", ({ page, action, file }) => {
  it("is a server page that reads its state from the URL", () => {
    // A client page cannot page on the server: it has already had to fetch
    // something before it can render anything, and what it fetched is whatever
    // the browser asked for. Both of the pages fixed most recently were client
    // pages calling an action from a `useEffect`.
    expect(existsSync(page)).toBe(true);
    const src = read(page);
    expect(src.startsWith('"use client"')).toBe(false);
    expect(src).toContain("parseListParams");
    expect(src).toContain(action);
  });

  it("⚠️ asks the database for one page, not for everything", () => {
    const body = bodyOf(file, action);
    expect(body).not.toBe("");
    expect(body).toContain("limit(params.pageSize)");
    expect(body).toContain("offset(offsetOf(params))");
  });

  it("⚠️ counts the rows over the same query it lists them from", () => {
    // The total decides how many pages there are. Counted over a different set —
    // a count without the joins the search filters on, say — it promises pages
    // that come back empty, and the person concludes rows are missing.
    const body = bodyOf(file, action);
    expect(body).toContain("count()");
    expect(body).toContain("toPage(");
  });
});

describe("the tasks list", () => {
  // Tasks are the exception, and the reason is worth writing down: the board view
  // groups every task into three columns, and a column showing "the first fifty
  // of them" is not a column. So the bound is on age rather than on count —
  // everything open, plus what was finished inside the window.
  const action = bodyOf("src/actions/tasks.ts", "getAllTasks");

  it("⚠️ leaves out what was finished long ago", () => {
    expect(action).toContain("DONE_WINDOW_DAYS");
    expect(action).toContain("'done'");
  });

  it("⚠️ still opens a task somebody was linked to, however old", () => {
    // A notification about a task points at it by id. If the window could hide
    // the task the link names, the link would open an empty screen — and the
    // person would have no way to tell that from the task having been deleted.
    expect(action).toContain("alwaysInclude");
  });

  it("⚠️ never reads the whole table, archive included", () => {
    // `?done=all` deliberately removes the age window. Without a cap that is the
    // same unbounded read the window exists to prevent, reached by a link.
    expect(action).toContain("limit(TASK_LIST_CAP)");
    expect(action).toContain("capped");
  });

  it("says how many it left out", () => {
    // A list that quietly drops rows is worse than a short one: the person
    // counts, disagrees with the screen, and stops trusting it.
    expect(action).toContain("hiddenDone");
    expect(read(`${DASHBOARD}/tasks/_components/tasks-client.tsx`)).toContain("olderDoneHidden");
  });
});

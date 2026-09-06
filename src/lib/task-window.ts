/**
 * How far back a finished task keeps showing up in the task list on its own.
 *
 * A task list is a queue, not an archive. Everything still open belongs on it
 * whatever its age; something ticked off last spring belongs in a search, and
 * `?done=all` is that search.
 *
 * ⚠️ This lives here rather than beside the query because `src/actions/tasks.ts`
 * is a `"use server"` module, and those may export nothing but async functions —
 * a plain constant there is a build error, not a lint warning. The screen that
 * writes the sentence and the query that applies the window both read it from
 * here, so they cannot disagree about the number.
 */
export const DONE_WINDOW_DAYS = 30;

/**
 * The most tasks one screen will load, window or archive.
 *
 * The age window is the bound that matters day to day, but it is a bound on
 * *when*, not on *how many*: a workspace with four thousand open tasks is still
 * four thousand rows and six joins. And `?done=all` deliberately removes the
 * window, which without this would be the same unbounded read the window was
 * added to stop.
 *
 * The list says when the cap has bitten, because a list that silently stops at
 * five hundred is a list somebody will count and disagree with.
 */
export const TASK_LIST_CAP = 500;

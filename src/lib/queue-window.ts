/**
 * How much of a work queue a screen loads.
 *
 * A task list and a ticket list are queues, not archives. Everything still open
 * belongs on one whatever its age; something closed last spring belongs in a
 * search. Both screens also have a board view, and a board cannot be paged —
 * a column showing "the first fifty of them" is not a column — so the bound here
 * is on age and on volume rather than on pages.
 *
 * ⚠️ This lives in `lib` rather than beside the queries because
 * `src/actions/tasks.ts` and `src/actions/support.ts` are `"use server"` modules,
 * and those may export nothing but async functions: a plain constant there is a
 * build error, not a lint warning. The screens that write the sentence and the
 * queries that apply the bound both read it from here, so they cannot disagree
 * about the number.
 */

/** How far back a finished task keeps showing up in the task list on its own. */
export const DONE_WINDOW_DAYS = 30;

/** How far back a resolved or closed ticket keeps showing up on its own. */
export const TICKET_WINDOW_DAYS = 30;

/**
 * The most rows either screen will load, window or archive.
 *
 * The age window is the bound that matters day to day, but it is a bound on
 * *when*, not on *how many*: a workspace with four thousand open tasks is still
 * four thousand rows and six joins. And the archive links deliberately remove
 * the window, which without this would be the same unbounded read the window was
 * added to stop.
 *
 * Both screens say when the cap has bitten, because a list that silently stops
 * at five hundred is a list somebody will count and disagree with.
 */
export const TASK_LIST_CAP = 500;

/** Tickets carry their last message and three joins, so they are heavier. */
export const TICKET_LIST_CAP = 300;

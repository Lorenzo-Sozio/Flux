/**
 * The columns of a user that may leave the server.
 *
 * ⚠️⚠️ A relational query written as `with: { owner: true }` selects **every**
 * column of the related row, and whatever a server action or route returns is
 * serialised to whoever called it. The `user` table carries three columns that
 * must never make that trip:
 *
 *   externalCalendarUrl  a *secret* iCal address. Whoever holds it reads that
 *                        person's whole private calendar. The schema promised it
 *                        was shown back only to its owner.
 *   password             empty in tenant databases today, because the copy that
 *                        lands there omits it — which is a property of one insert,
 *                        not of the table.
 *   role                 the platform staff scale, meaningless to a customer and
 *                        no business of theirs.
 *
 * Seventeen queries loaded the row whole. Opening a ticket sent the calendar
 * address of everybody who had written on it, and the public quote endpoint sent
 * the quote owner's to the customer holding the link.
 *
 * Name a column set from here instead of writing `true`.
 * `src/lib/user-columns.test.ts` fails on the first `true` anybody adds back.
 */

/** Enough to show who someone is inside the workspace. */
export const USER_SUMMARY_COLUMNS = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

/**
 * What an outsider holding a public link may see of the person who sent them a
 * quote: a name to address and an address to write to. Not an id, which is an
 * internal handle with no use outside the workspace.
 */
export const PUBLIC_CONTACT_COLUMNS = {
  name: true,
  email: true,
} as const;

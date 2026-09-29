/**
 * Statements that must land together: one transaction, on either driver.
 *
 * On Neon's HTTP driver `db.batch` is its transaction endpoint; on the pooled driver it is a real
 * transaction on one connection (src/db/index.ts); PGlite in the tests has neither and gets
 * `db.transaction`. Each statement runs in order and sees what the ones before it committed to
 * the transaction — which is what makes "lock a row, then check" work under READ COMMITTED: the
 * check is a new statement, so it reads after the lock was granted.
 *
 * Builders and raw `db.execute(sql…)` both work.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export async function together(db: AnyDb, statements: (h: AnyDb) => unknown[]): Promise<unknown[]> {
  if (typeof db.batch === "function") return db.batch(statements(db));
  return db.transaction(async (tx: AnyDb) => {
    const out: unknown[] = [];
    for (const statement of statements(tx)) out.push(await statement);
    return out;
  });
}

/** The rows of a raw statement's result, whichever shape the driver gives. */
export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] })?.rows ?? [])) as T[];
}

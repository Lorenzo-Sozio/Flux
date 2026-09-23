/**
 * db-url.ts — reading a Postgres connection string without trusting it.
 *
 * Two questions are asked of a connection string in this product, and both of them
 * decide something that cannot be undone by hand afterwards: *which driver* speaks to
 * it (src/lib/db-ssl.ts) and *whether it is the platform's own database* — because a
 * workspace pointed at the registry has the tenant migrations run over it, and those
 * create and alter tables in a database that was never theirs to touch.
 *
 * ⚠️ Parsed by hand rather than with `new URL()`: a Postgres password is allowed
 * characters that make the URL parser throw, and a string that cannot be read is not a
 * reason to answer "no" to a safety question.
 */

export interface DbTarget {
  host: string;
  port: number;
  database: string;
}

const DEFAULT_PORT = 5432;

/** Host, port and database name, or null when the string is not a connection string. */
export function parseDbUrl(url: string | null | undefined): DbTarget | null {
  if (!url) return null;
  const match = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/?#]+)(?:\/([^?#]*))?/i.exec(url.trim());
  if (!match) return null;

  const authority = match[1].toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority);
  const host = bracketed ? bracketed[1] : authority.split(":")[0];
  const port = Number(bracketed ? bracketed[2] : authority.split(":")[1]) || DEFAULT_PORT;
  if (!host) return null;

  // The database name is percent-encoded in the path, and an empty path means the
  // server's default database — not "no database".
  const database = decodeURIComponent(match[2] ?? "").replace(/\/+$/, "");
  return { host, port, database };
}

/**
 * Whether two connection strings name the same database on the same server.
 *
 * ⚠️ A string that cannot be parsed counts as **the same**, deliberately. This answers
 * "may I run migrations over this?", and the safe answer to "I cannot tell" is no.
 */
export function sameDatabase(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = parseDbUrl(a);
  const right = parseDbUrl(b);
  if (!left || !right) return true;
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

/** The connection string with the password replaced, for a log or a message. */
export function redactDbUrl(url: string): string {
  return url.replace(/:\/\/([^:@/]+):([^@/]*)@/, "://$1:***@");
}

/**
 * error-kind.ts — what kind of wrong an error is, from the only thing that survives.
 *
 * An exception crossing React's error boundary arrives as a plain `Error` with a
 * message: the class, the cause and the stack are gone. So the boundary reads the
 * message, and this is where that reading lives — a pure function, because the three
 * answers it gives lead to three different screens and one of them reloads the page.
 */

export type ErrorKind = "forbidden" | "entitlement" | "stale" | "unknown";

/**
 * ⚠️⚠️ **A tab open across a deploy is holding code that no longer exists.** The page
 * fetches the rest of its JavaScript later, by a name containing a hash of the
 * contents, and the deploy changed that hash: the request 404s and React reports an
 * exception with no relation to what the reader was doing — "module factory is not
 * available", "Loading chunk 402 failed". It reads as the product being broken, and
 * every one of them is fixed by loading the page again.
 *
 * Each spelling below belongs to a different bundler or browser, and one missing
 * spelling is a reader told "something went wrong" about a page a reload would fix.
 */
export const STALE_BUILD =
  /module factory is not available|chunkloaderror|loading chunk .+? failed|failed to fetch dynamically imported module|importing a module script failed/i;

export function classifyError(message: string): ErrorKind {
  const m = message.toLowerCase();

  // ⚠️ Before everything else, and narrowly: this verdict reloads the page, so a
  // pattern that matched too much would hide a refusal behind a flicker.
  if (STALE_BUILD.test(m)) return "stale";

  if (
    m.includes("permission") ||
    m.includes("read-only") ||
    m.includes("only workspace") ||
    m.includes("only the workspace")
  ) {
    return "forbidden";
  }
  if (m.includes("plan") || m.includes("limit") || m.includes("upgrade") || m.includes("subscription")) {
    return "entitlement";
  }
  return "unknown";
}

/**
 * Whether this tab should reload itself after a stale-build error, stamping that it
 * has. Separate from the reload so it can be tested: a reload that does not fix the
 * page would otherwise loop for ever, and nothing about the line that starts it says
 * how it stops.
 */
export const RELOAD_STAMP = "flux.stale-reload";
const RELOAD_WINDOW_MS = 5 * 60_000;

export function shouldReloadForStaleBuild(
  store: Pick<Storage, "getItem" | "setItem"> | undefined,
  now: number = Date.now(),
): boolean {
  // ⚠️ No storage, no reload. A tab that cannot remember having tried cannot know
  // not to try again, and a private window would flicker for ever.
  if (!store) return false;
  try {
    const last = Number(store.getItem(RELOAD_STAMP) ?? 0);
    if (now - last < RELOAD_WINDOW_MS) return false;
    store.setItem(RELOAD_STAMP, String(now));
    return true;
  } catch {
    return false;
  }
}

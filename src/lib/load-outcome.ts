/**
 * A figure that could not be loaded, told apart from a figure that is zero (I14).
 *
 * ⚠️⚠️ Pages used to write `.catch(() => null)` and then `?? 0`: a database that did not answer
 * showed "€ 0 overdue", which reads as good news. A failure is now an outcome of its own — the
 * screen says the figure is unavailable, and the error is logged where somebody can find it.
 * A plan without the module is not a failure: the card is simply not there, as before.
 *
 * Next's own control flow (redirect, notFound) is thrown as an error with a `NEXT_` digest and
 * must travel on, never be caught as a failure.
 */

export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: "plan" | "error" };

export async function loadOutcome<T>(what: string, run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    const e = err as { digest?: unknown; name?: unknown };
    if (typeof e?.digest === "string" && e.digest.startsWith("NEXT_")) throw err;
    if (e?.name === "EntitlementError") return { ok: false, reason: "plan" };
    console.error(`[${what}] could not be loaded`, err);
    return { ok: false, reason: "error" };
  }
}

/** The value, or null when it did not load for any reason. */
export const loadedValue = <T>(o: Outcome<T>): T | null => (o.ok ? o.value : null);

/** Whether it failed — not merely absent from the plan. */
export const failed = (o: Outcome<unknown>): boolean => !o.ok && o.reason === "error";

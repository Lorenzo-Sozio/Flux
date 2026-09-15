import { formatOrderNumber, nextInSequence, orderScope, orderSeed } from "@/lib/document-counter";

/**
 * The next order number, in sequence.
 *
 * An order used to carry a random UUID as its number, so two orders placed a minute apart
 * were unrelated strings: nobody could tell which came first, a gap could not be spotted,
 * and a customer received a document whose number carries no sequence — which is not what a
 * commercial document is for (audit rilievo C-05).
 *
 * ⚠️ It then became `max(order_number) + 1` for the year, which read well and failed two
 * ways: two orders created together got the same number and the second failed to save, and
 * `max()` on text sorts `ORD-2026-10000` below `ORD-2026-9999`, so past that size every
 * order failed until the new year. It is a counter advanced in one statement now — see
 * src/lib/document-counter.ts. The first call of a year seeds itself from the numbers
 * already issued, compared as numbers, so existing workspaces carry straight on.
 *
 * ## ⚠️ Why it lives here and not next to the order actions
 *
 * Because a second caller arrived — the API route that records an order taken by the
 * assistant — and a second implementation of a numbering sequence is the way two orders end
 * up sharing a number. It could not simply be exported from the actions file either: that
 * module is `"use server"`, where every export becomes an endpoint anyone can call, and
 * «give me the next order number» is not something to publish.
 */
// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
export async function nextOrderNumber(db: any, now = new Date()): Promise<string> {
  const year = now.getFullYear();
  const value = await nextInSequence(db, orderScope(year), orderSeed(year));
  return formatOrderNumber(year, value);
}

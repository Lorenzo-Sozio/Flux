/**
 * What `order.source` says when the order was taken by the assistant.
 *
 * ⚠️ It lives here rather than beside the query that reads it because
 * `src/actions/assistant-contribution.ts` is a `"use server"` module, and those
 * may export nothing but async functions. A plain constant there is a **build
 * error**, not a lint warning, and it fails the production build with a message
 * that names the line but not the rule — which is how it reached main.
 *
 * The value itself is the one `source` already carried on a contact the
 * assistant created, so the two halves of the same event agree.
 */
export const SORGENTE_ASSISTENTE = "assistant";

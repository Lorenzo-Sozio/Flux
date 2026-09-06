/**
 * Retrying a delivery that failed, without touching the schema.
 *
 * ## ⚠️⚠️ Why there is no outbox table
 *
 * The obvious shape is to give `webhook_log` a counter, a state and a next-attempt
 * time. **Measured before writing any of it**: the tenant databases have different
 * migration histories — one has twelve applied, another two, and the repository holds
 * two files — so the mechanism for adding a column to *every* tenant is not currently
 * reliable. Building a delivery guarantee on ground that does not hold is how you end
 * up with two problems instead of one.
 *
 * And it is not needed. `webhook_log` **already** records every attempt with its
 * outcome, and the envelope **already** carries the event id: everything follows from
 * those two facts.
 *
 * * *what is still undelivered* — the events whose most recent attempt failed;
 * * *how many times it has been tried* — how many rows carry that event id;
 * * *when to try again* — the last attempt plus the wait that attempt has earned.
 *
 * ⚠️ The **same body** is sent again, so the same id and the same signature: the
 * receiver deduplicates and the retry does not become a second event. That is precisely
 * what the id is for.
 *
 * ## What is NOT retried
 *
 * An attempt that never left because the webhook has no secret. Retrying does not add
 * one: it would repeat, for days, a row that is asking to be configured — filling the log
 * with noise in exactly the place somebody goes to find out why.
 */
import { createHmac } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { webhookLogs, webhooks } from "@/db/schema";
import { BACKOFF_MS, MAX_ATTEMPTS, UNSIGNABLE_PREFIX } from "@/lib/webhook-envelope";
import { validateWebhookUrl } from "@/lib/webhook-validator";

export interface RetryOutcome {
  /** Consegnati now. */
  delivered: number;
  /** Retried and failed again: they stay queued until the attempts run out. */
  failed: number;
  /** Not due yet, or out of attempts. */
  deferred: number;
}

interface Riga {
  id: string;
  webhookId: string;
  event: string;
  payload: string | null;
  response: string | null;
  success: boolean;
  sentAt: Date;
}

/** The event id, which lives inside the body that was sent. */
export function eventIdOf(payload: string | null): string {
  if (!payload) return "";
  try {
    const envelope = JSON.parse(payload);
    return typeof envelope?.id === "string" ? envelope.id : "";
  } catch {
    return "";
  }
}

/**
 * Which events are due for a retry **now**, given the history of attempts.
 *
 * Pure on purpose: this is the part that decides, and deciding needs no database. The
 * worker only reads the rows and sends whatever this function names.
 */
export function isRetryable(righe: Riga[], now = new Date()): Riga[] {
  const perEvento = new Map<string, Riga[]>();
  for (const riga of righe) {
    const id = eventIdOf(riga.payload);
    if (!id) continue;
    const elenco = perEvento.get(id) ?? [];
    elenco.push(riga);
    perEvento.set(id, elenco);
  }

  const scelti: Riga[] = [];
  for (const attempts of perEvento.values()) {
    const ordinati = [...attempts].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
    const ultimo = ordinati[0];

    // Already arrived: any successful attempt closes the matter, even if earlier ones
    // failed dieci prima.
    if (attempts.some((t) => t.success)) continue;
    // Never left for want of a secret: not a network fault, a configuration one.
    if ((ultimo.response ?? "").startsWith(UNSIGNABLE_PREFIX)) continue;
    if (attempts.length >= MAX_ATTEMPTS) continue;

    // ⚠️ The wait grows with the attempts and the last one repeats: a provider that has
    // been down for hours should not be hammered, nor given up on early.
    const attesa = BACKOFF_MS[Math.min(attempts.length - 1, BACKOFF_MS.length - 1)];
    if (now.getTime() - ultimo.sentAt.getTime() < attesa) continue;

    scelti.push(ultimo);
  }
  return scelti;
}

/**
 * Retries the deliveries that are due. Returns what happened, for the worker's log.
 *
 * ⚠️ Every attempt writes **a new row** rather than updating the previous one: the
 * history of attempts is what the count is derived from, and rewriting it would erase it.
 */
export async function riprova(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  limite = 50,
): Promise<RetryOutcome> {
  const righe: Riga[] = await db.select().from(webhookLogs).orderBy(desc(webhookLogs.sentAt)).limit(500);

  const dovuti = isRetryable(righe).slice(0, limite);
  const outcome: RetryOutcome = { delivered: 0, failed: 0, deferred: 0 };

  for (const riga of dovuti) {
    const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, riga.webhookId));
    if (!wh || !wh.isActive || !wh.secret || validateWebhookUrl(wh.url)) {
      // The webhook has since been switched off, deleted or made invalid: this is not a
      // failed delivery, it is that there is nothing left to deliver to.
      outcome.deferred += 1;
      continue;
    }

    const body = riga.payload ?? "";
    const signature = `sha256=${createHmac("sha256", wh.secret).update(body).digest("hex")}`;
    try {
      const res = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Id": eventIdOf(body),
        },
        body: body,
        signal: AbortSignal.timeout(10_000),
      });
      await db.insert(webhookLogs).values({
        webhookId: wh.id,
        event: riga.event,
        payload: body,
        statusCode: res.status,
        response: await res.text().catch(() => ""),
        success: res.ok,
      });
      if (res.ok) outcome.delivered += 1;
      else outcome.failed += 1;
    } catch (err) {
      await db.insert(webhookLogs).values({
        webhookId: wh.id,
        event: riga.event,
        payload: body,
        statusCode: null,
        response: String(err),
        success: false,
      });
      outcome.failed += 1;
    }
  }
  return outcome;
}

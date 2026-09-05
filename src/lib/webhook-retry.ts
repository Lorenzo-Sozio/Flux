/**
 * Ritentare una consegna fallita, senza toccare lo schema.
 *
 * ## ⚠️⚠️ Perché non c'è una tabella di outbox
 *
 * La forma ovvia sarebbe aggiungere a `webhook_log` un contatore, uno stato e un next
 * attempt. **Misurato prima di scrivere**: i database dei tenant hanno storie di
 * migrazione diverse — uno ne ha dodici applicate, un altro due, e nel repository i file
 * sono due — quindi il meccanismo con cui si aggiunge una colonna a *tutti* i tenant oggi
 * non è affidabile. Costruire una garanzia di consegna su un fondo che non tiene è il modo
 * di avere due problemi invece di uno.
 *
 * E non serve. `webhook_log` registra **già** ogni tentativo con il proprio esito, e la
 * envelope porta **già** l'identificativo dell'evento: da quelle due cose si ricava tutto.
 *
 * * *che cosa è ancora da consegnare* — gli eventi il cui tentativo più recente è fallito;
 * * *quante volte ci si è provato* — quante righe portano quell'identificativo;
 * * *quando riprovare* — dal momento dell'ultimo tentativo più l'attesa che gli spetta.
 *
 * ⚠️ Si rispedisce **lo stesso corpo**, quindi lo stesso identificativo e la stessa firma:
 * chi riceve deduplica e il ritentativo non diventa un secondo evento. È precisamente ciò
 * per cui l'identificativo esiste.
 *
 * ## Che cosa NON si ritenta
 *
 * Un tentativo che non è mai partito perché il webhook non ha un segreto. Ritentarlo non
 * aggiunge un segreto: ripeterebbe per giorni una riga che chiede una configurazione, e il
 * registro si riempirebbe di rumore proprio dove si va a cercare il motivo.
 */
import { createHmac } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { webhookLogs, webhooks } from "@/db/schema";
import { BACKOFF_MS, MAX_ATTEMPTS, UNSIGNABLE_PREFIX } from "@/lib/webhook-envelope";
import { validateWebhookUrl } from "@/lib/webhook-validator";

export interface RetryOutcome {
  /** Consegnati now. */
  delivered: number;
  /** Riprovati e falliti di nuovo: restano in coda finché non finiscono i tentativi. */
  failed: number;
  /** Non ancora dovuti, o senza più attempts. */
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

/** L'identificativo dell'evento, che vive dentro il corpo spedito. */
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
 * Quali eventi vanno riprovati **now**, dato lo storico dei attempts.
 *
 * Pura di proposito: è la parte che decide, e decidere non ha bisogno di un database. Il
 * worker si limita a leggere le righe e a spedire ciò che questa funzione indica.
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

    // Già arrivato: qualunque attempt riuscito chiude la partita, anche se ne erano
    // failed dieci prima.
    if (attempts.some((t) => t.success)) continue;
    // Mai partito per mancanza di segreto: non è un guasto di rete, è una configurazione.
    if ((ultimo.response ?? "").startsWith(UNSIGNABLE_PREFIX)) continue;
    if (attempts.length >= MAX_ATTEMPTS) continue;

    // ⚠️ L'attesa cresce con i tentativi, e l'ultima si ripete: un fornitore che è giù da
    // ore non va martellato, ma nemmeno abbandonato prima del tempo.
    const attesa = BACKOFF_MS[Math.min(attempts.length - 1, BACKOFF_MS.length - 1)];
    if (now.getTime() - ultimo.sentAt.getTime() < attesa) continue;

    scelti.push(ultimo);
  }
  return scelti;
}

/**
 * Riprova le consegne dovute. Torna che cosa è successo, per il log del worker.
 *
 * ⚠️ Ogni tentativo scrive **una riga nuova**, non aggiorna la precedente: la storia dei
 * tentativi è ciò da cui si ricava il conteggio, e riscriverla la cancellerebbe.
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
      // Il webhook nel frattempo è stato spento, cancellato o è diventato non valido:
      // non è un fallimento di consegna, è che non c'è più niente a cui consegnare.
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

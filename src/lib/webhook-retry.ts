/**
 * Ritentare una consegna fallita, senza toccare lo schema.
 *
 * ## ⚠️⚠️ Perché non c'è una tabella di outbox
 *
 * La forma ovvia sarebbe aggiungere a `webhook_log` un contatore, uno stato e un prossimo
 * tentativo. **Misurato prima di scrivere**: i database dei tenant hanno storie di
 * migrazione diverse — uno ne ha dodici applicate, un altro due, e nel repository i file
 * sono due — quindi il meccanismo con cui si aggiunge una colonna a *tutti* i tenant oggi
 * non è affidabile. Costruire una garanzia di consegna su un fondo che non tiene è il modo
 * di avere due problemi invece di uno.
 *
 * E non serve. `webhook_log` registra **già** ogni tentativo con il proprio esito, e la
 * busta porta **già** l'identificativo dell'evento: da quelle due cose si ricava tutto.
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
import { ATTESE_MS, NON_FIRMABILE, TENTATIVI_MASSIMI } from "@/lib/webhook-envelope";
import { validateWebhookUrl } from "@/lib/webhook-validator";

export interface EsitoRitentativi {
  /** Consegnati adesso. */
  consegnati: number;
  /** Riprovati e falliti di nuovo: restano in coda finché non finiscono i tentativi. */
  falliti: number;
  /** Non ancora dovuti, o senza più tentativi. */
  rimandati: number;
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
export function identificativoDi(payload: string | null): string {
  if (!payload) return "";
  try {
    const busta = JSON.parse(payload);
    return typeof busta?.id === "string" ? busta.id : "";
  } catch {
    return "";
  }
}

/**
 * Quali eventi vanno riprovati **adesso**, dato lo storico dei tentativi.
 *
 * Pura di proposito: è la parte che decide, e decidere non ha bisogno di un database. Il
 * worker si limita a leggere le righe e a spedire ciò che questa funzione indica.
 */
export function daRiprovare(righe: Riga[], adesso = new Date()): Riga[] {
  const perEvento = new Map<string, Riga[]>();
  for (const riga of righe) {
    const id = identificativoDi(riga.payload);
    if (!id) continue;
    const elenco = perEvento.get(id) ?? [];
    elenco.push(riga);
    perEvento.set(id, elenco);
  }

  const scelti: Riga[] = [];
  for (const tentativi of perEvento.values()) {
    const ordinati = [...tentativi].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
    const ultimo = ordinati[0];

    // Già arrivato: qualunque tentativo riuscito chiude la partita, anche se ne erano
    // falliti dieci prima.
    if (tentativi.some((t) => t.success)) continue;
    // Mai partito per mancanza di segreto: non è un guasto di rete, è una configurazione.
    if ((ultimo.response ?? "").startsWith(NON_FIRMABILE)) continue;
    if (tentativi.length >= TENTATIVI_MASSIMI) continue;

    // ⚠️ L'attesa cresce con i tentativi, e l'ultima si ripete: un fornitore che è giù da
    // ore non va martellato, ma nemmeno abbandonato prima del tempo.
    const attesa = ATTESE_MS[Math.min(tentativi.length - 1, ATTESE_MS.length - 1)];
    if (adesso.getTime() - ultimo.sentAt.getTime() < attesa) continue;

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
): Promise<EsitoRitentativi> {
  const righe: Riga[] = await db.select().from(webhookLogs).orderBy(desc(webhookLogs.sentAt)).limit(500);

  const dovuti = daRiprovare(righe).slice(0, limite);
  const esito: EsitoRitentativi = { consegnati: 0, falliti: 0, rimandati: 0 };

  for (const riga of dovuti) {
    const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, riga.webhookId));
    if (!wh || !wh.isActive || !wh.secret || validateWebhookUrl(wh.url)) {
      // Il webhook nel frattempo è stato spento, cancellato o è diventato non valido:
      // non è un fallimento di consegna, è che non c'è più niente a cui consegnare.
      esito.rimandati += 1;
      continue;
    }

    const corpo = riga.payload ?? "";
    const firma = `sha256=${createHmac("sha256", wh.secret).update(corpo).digest("hex")}`;
    try {
      const res = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": firma,
          "X-Webhook-Id": identificativoDi(corpo),
        },
        body: corpo,
        signal: AbortSignal.timeout(10_000),
      });
      await db.insert(webhookLogs).values({
        webhookId: wh.id,
        event: riga.event,
        payload: corpo,
        statusCode: res.status,
        response: await res.text().catch(() => ""),
        success: res.ok,
      });
      if (res.ok) esito.consegnati += 1;
      else esito.falliti += 1;
    } catch (err) {
      await db.insert(webhookLogs).values({
        webhookId: wh.id,
        event: riga.event,
        payload: corpo,
        statusCode: null,
        response: String(err),
        success: false,
      });
      esito.falliti += 1;
    }
  }
  return esito;
}

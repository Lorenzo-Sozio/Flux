import { runCronJob } from "@/lib/cron-runner";
import { riprova } from "@/lib/webhook-retry";

/**
 * Riprova le consegne di webhook fallite, per ogni workspace.
 *
 *   Esterno:  curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/webhook-retry
 *
 * WARN **Senza questo, un evento perso e perso**, e chi lo aspettava non ha modo di
 * saperlo: un'integrazione che riceve gli eventi «quasi sempre» e un'integrazione di cui
 * non ci si puo fidare per decidere qualcosa.
 *
 * WARN Prima di `runCronJob` questa rotta apriva un solo database con `getDb()`, che legge
 * il tenant da un header che una richiesta schedulata non porta: il job lanciava
 * un'eccezione prima di ritentare qualsiasi cosa, quindi la consegna era di fatto
 * *at-most-once* nonostante la documentazione dicesse il contrario (rilievo B-02).
 *
 * Che cosa riprovare lo decide `lib/webhook-retry`, che e pura e testata: qui c'e solo
 * l'autenticazione del cron e il ciclo sui workspace.
 */
export async function GET(req: Request) {
  return runCronJob("webhook-retry", req, async (db) => riprova(db));
}

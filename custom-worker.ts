/**
 * Entrypoint del Worker Cloudflare.
 *
 * OpenNext genera `.open-next/worker.js`, che esporta solo `fetch`. I Cron Trigger
 * di Cloudflare non fanno una richiesta HTTP all'app: invocano l'export `scheduled`.
 * Senza questo file i job dichiarati in wrangler.jsonc non chiamerebbero nulla — e
 * come dice CLAUDE.md, una route che nessuno chiama è un job che silenziosamente non
 * gira: niente logga l'assenza.
 *
 * Qui `scheduled` ricostruisce la richiesta che Vercel mandava da sola — stesso path,
 * stesso header `Authorization: Bearer $CRON_SECRET` — e la passa al fetch handler di
 * Next. Le route di `src/app/api/cron/` restano invariate e continuano a funzionare
 * anche se chiamate da fuori con curl.
 *
 * Il file è escluso da tsconfig.json: `.open-next/worker.js` non esiste finché
 * `opennextjs-cloudflare build` non l'ha generato, quindi `next build` non deve
 * provare a type-checkarlo. Lo bundla wrangler con esbuild.
 */
// @ts-expect-error - generato da `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";

/**
 * Mappa schedule → route da chiamare. Le chiavi devono corrispondere ESATTAMENTE
 * alle stringhe in `triggers.crons` di wrangler.jsonc: Cloudflare passa il cron che
 * ha fatto scattare l'invocazione come stringa, e un mismatch di un solo carattere
 * fa cadere il job in un no-op silenzioso (loggato come errore qui sotto).
 *
 * Job che condividono la stessa schedule stanno nello stesso array, così sette job
 * occupano cinque Cron Trigger.
 */
const CRON_JOBS: Record<string, readonly string[]> = {
  "* * * * *": ["/api/cron/email-worker"],
  "*/5 * * * *": ["/api/cron/webhook-retry", "/api/cron/campaign-scheduler"],
  "*/15 * * * *": ["/api/cron/task-reminders", "/api/cron/ticket-sla-check"],
  "0 6 * * *": ["/api/cron/task-overdue-check"],
  "0 3 * * *": ["/api/cron/ticket-autoclose"],
};

async function runCronJob(path: string, base: string, secret: string, env: unknown, ctx: ExecutionContext) {
  const request = new Request(new URL(path, base), {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  try {
    const response = await handler.fetch(request, env, ctx);
    // Il corpo va consumato: una Response abbandonata a metà stream viene
    // cancellata, e con lei il lavoro che la route stava ancora facendo.
    const body = await response.text();

    if (response.ok) {
      console.log(`[cron] ${path} → ${response.status} ${body.slice(0, 500)}`);
    } else {
      console.error(`[cron] ${path} → ${response.status} ${body.slice(0, 500)}`);
    }
  } catch (error) {
    console.error(`[cron] ${path} ha lanciato un'eccezione`, error);
  }
}

export default {
  fetch: handler.fetch,

  async scheduled(controller: ScheduledController, env: Record<string, string>, ctx: ExecutionContext) {
    const paths = CRON_JOBS[controller.cron];
    if (!paths) {
      console.error(`[cron] schedule "${controller.cron}" non è mappata in CRON_JOBS — nessun job eseguito`);
      return;
    }

    // Entrambe le variabili sono obbligatorie e falliscono rumorosamente:
    // verifyCronRequest fallisce già closed lato route, ma un 500 al minuto per
    // sempre è più difficile da notare di una riga di errore qui.
    const base = env.NEXT_PUBLIC_APP_URL;
    if (!base) {
      console.error("[cron] NEXT_PUBLIC_APP_URL non è configurata sul Worker — job non eseguiti");
      return;
    }

    const secret = env.CRON_SECRET;
    if (!secret) {
      console.error("[cron] CRON_SECRET non è configurato sul Worker — job non eseguiti");
      return;
    }

    ctx.waitUntil(Promise.all(paths.map((path) => runCronJob(path, base, secret, env, ctx))));
  },
};

// Da riesportare solo se si abilitano la DO Queue o la DO Tag Cache in
// open-next.config.ts:
// export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

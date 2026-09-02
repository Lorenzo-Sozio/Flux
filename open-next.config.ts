import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Cache incrementale su R2. Richiede il bucket e il binding
// NEXT_INC_CACHE_R2_BUCKET in wrangler.jsonc — vedi il commento lì.
// import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

/**
 * Configurazione dell'adapter OpenNext → Cloudflare Workers.
 *
 * Senza `incrementalCache` la app funziona, ma `revalidatePath()` non ha nulla da
 * invalidare fra un'invocazione e l'altra: le pagine dinamiche/autenticate (cioè
 * quasi tutta la dashboard) non se ne accorgono, le pagine ISR sì.
 */
export default defineCloudflareConfig({
  // incrementalCache: r2IncrementalCache,
});

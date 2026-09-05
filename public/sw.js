/**
 * Flux CRM — service worker.
 *
 * ⚠️⚠️ **This worker never caches a customer's data, and that is a decision, not
 * an omission.**
 *
 * A CRM is multi-user, multi-tenant and permission-filtered. Every one of those
 * makes a cached page dangerous in a way a cached blog post is not:
 *
 *   • Tenant. One browser signs in to two workspaces. A cached /dashboard/crm
 *     is one workspace's figures, and Cache Storage does not know about the
 *     `x-tenant-id` header that produced it — so the second workspace opens the
 *     first one's dashboard. That is a customer seeing another customer's data,
 *     and it looks exactly like a working page.
 *   • Permissions. What a page contains depends on who asked for it. A cached
 *     copy outlives a role change and a revoked membership.
 *   • Staleness. A pipeline, a ticket queue and a stock figure that are twenty
 *     minutes old are worse than absent, because nothing on the screen says so
 *     and somebody quotes from them.
 *
 * So: **only the application shell is cached** — the content-hashed JavaScript
 * and CSS Next.js emits, the icons, and one offline page. Every navigation and
 * every API call goes to the network, and when the network is not there the
 * offline page says so plainly rather than showing yesterday's numbers.
 *
 * The upside of an app shell cache is still real: on a slow connection the
 * interface appears immediately and only the data is waited for, which is most
 * of what "feels like an app" actually means.
 */

const VERSION = "v1";
const SHELL_CACHE = `flux-shell-${VERSION}`;
const ASSET_CACHE = `flux-assets-${VERSION}`;
const OFFLINE_URL = "/offline";

/** Hashed build output only. Cached hard, because the URL changes when the content does. */
const IMMUTABLE_PREFIXES = ["/_next/static/", "/icons/"];

/** How many hashed assets to keep. Several deploys' worth, without growing forever. */
const ASSET_CACHE_LIMIT = 240;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Only the offline page. Precaching more would mean guessing at build
      // output filenames, and getting one wrong fails the whole install.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" })).catch((error) => {
        // Failing to fetch one page is not worth failing the whole install
        // over: the shell cache still works, and the browser tries again on the
        // next update check.
        console.warn("[sw] offline page not precached:", error);
      });
      // Do not skipWaiting here: the page decides when to take the update, so a
      // form being filled in is not swapped out from under the person filling it.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("flux-") && !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** The page asks for the update when it is safe to take one. */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** Keeps the asset cache from growing without bound across deploys. */
async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  // Oldest first — Cache Storage preserves insertion order.
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that is not a plain GET is a mutation. Server actions arrive as
  // POSTs to ordinary page URLs, so this check is what keeps the worker out of
  // the write path entirely.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch authentication or the API. A cached session probe is a way to
  // be logged in after logging out.
  if (url.pathname.startsWith("/api/")) return;

  // ── The app shell: content-hashed, immutable, safe to serve from disk ──────
  if (IMMUTABLE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(ASSET_CACHE);
          await cache.put(request, response.clone());
          trimCache(ASSET_CACHE, ASSET_CACHE_LIMIT);
        }
        return response;
      })(),
    );
    return;
  }

  // ── Everything else: the network, or an honest offline page ───────────────
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const offline = await caches.match(OFFLINE_URL);
          return (
            offline ??
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })(),
    );
  }

  // React Server Component payloads and data requests fall through to the
  // network untouched. A stale one is a wrong screen with no warning on it.
});

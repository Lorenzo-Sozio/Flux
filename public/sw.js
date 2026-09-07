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

const VERSION = "v2";
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

// ── Notifications ────────────────────────────────────────────────────────────
//
// The one thing this worker does that the page cannot: it runs when no tab is
// open. A notification arrives encrypted, addressed to this installation, and is
// decrypted by the browser before it gets here — so `event.data` is already
// plain text and the push service in the middle never saw it.
//
// ⚠️ Every branch has to end in a shown notification. A push received with the
// `userVisibleOnly` permission and *not* shown is a broken promise to the
// browser: Chrome shows its own "This site has been updated in the background"
// message instead, and repeated often enough the browser revokes the permission
// altogether. So a malformed payload still produces something.

const FALLBACK_TITLE = "Flux";

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not our format. Show the raw text rather than nothing at all.
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = typeof data.title === "string" && data.title ? data.title : FALLBACK_TITLE;
  const link = typeof data.link === "string" && data.link.startsWith("/") ? data.link : "/dashboard";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      // Two reminders about the same task replace each other instead of filling
      // the tray with the same sentence four times.
      tag: typeof data.tag === "string" && data.tag ? data.tag : link,
      renotify: true,
      timestamp: Date.now(),
      data: { link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/dashboard";
  const target = new URL(link, self.location.origin).href;

  event.waitUntil(
    (async () => {
      // ⚠️ Focus a tab that is already open rather than opening another one.
      // Opening a second window on every notification is how a phone ends up with
      // eleven copies of the same app, each with its own unsaved form.
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        // `navigate` is not available on every platform, and failing to move an
        // already-focused tab is better than failing to focus anything.
        if ("navigate" in client) {
          try {
            await client.navigate(target);
          } catch {
            /* The tab stays where it was, focused. */
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// A subscription can be rotated by the browser without anyone touching it, and
// the old endpoint stops working the moment it happens.
//
// ⚠️ There is no session in here, so the worker cannot tell the server about the
// new one — a write has to be authenticated and the page is what holds the
// cookie. So the worker does the half it can: it re-subscribes immediately, with
// the same application key the old subscription carried, and tells any open page
// to send the result. If no page is open, PushSubscriptionKeeper picks it up on
// the next load. Until then pushes to this device are lost, which is the whole
// reason the notification itself lives in the database rather than in the push.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key =
        event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null;
      if (key) {
        try {
          await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        } catch {
          // Nothing here can fix it. The settings page still offers the button.
        }
      }
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" });
    })(),
  );
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

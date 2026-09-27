"use client";

import { useEffect } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

/**
 * Registers the service worker, and hands the decision to update to the person
 * using the app.
 *
 * ⚠️ The worker deliberately does **not** call `skipWaiting()` on install. A
 * deploy that takes effect the moment it lands reloads the tab underneath
 * whoever is typing into a quote, and the work is gone. Instead the new worker
 * waits, this component notices it waiting, and offers the reload. Anyone who
 * ignores the offer gets the new version on their next visit, which is the
 * ordinary case.
 *
 * Registration is production-only: in development the worker would serve a
 * stale shell against a dev server that has already rebuilt it, and the
 * resulting confusion costs more than the feature is worth locally.
 *
 * ⚠️ Not registering is not enough: in development an existing worker is
 * *removed*. One left behind by a production run on the same origin
 * (`next start` on localhost:3000) keeps serving `/_next/static/` from its cache
 * — safe in production, where those names are content hashes, and wrong in
 * development, where a chunk keeps its name while its contents change. The page
 * then boots on modules the dev server no longer has, and fails with "the module
 * factory is not available" in a component nobody touched.
 */
function removeDevelopmentWorkers() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const controlled = Boolean(navigator.serviceWorker.controller);
  Promise.all([
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister()))),
    typeof caches === "undefined"
      ? Promise.resolve()
      : caches
          .keys()
          .then((keys) => Promise.all(keys.filter((k) => k.startsWith("flux-")).map((k) => caches.delete(k)))),
  ])
    .then(() => {
      // Still controlled means this very page came through the old worker: load
      // it once more, from the network. The flag stops a loop if unregistering
      // did not take.
      if (!controlled) return;
      try {
        if (sessionStorage.getItem("flux-sw-removed")) return;
        sessionStorage.setItem("flux-sw-removed", "1");
      } catch {
        return;
      }
      window.location.reload();
    })
    // biome-ignore lint/suspicious/noEmptyBlockStatements: development convenience only
    .catch(() => {});
}

export function ServiceWorkerRegistrar() {
  const t = useTranslations("pwa");

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      removeDevelopmentWorkers();
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    const offerUpdate = (worker: ServiceWorker) => {
      toast(t("updateTitle"), {
        description: t("updateBody"),
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: t("updateAction"),
          onClick: () => worker.postMessage("SKIP_WAITING"),
        },
      });
    };

    const watch = (registration: ServiceWorkerRegistration) => {
      // Already waiting when the page loaded — a previous visit fetched it.
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `controller` is null on the very first install, when there is no
          // previous version and nothing to tell anybody about.
          if (installing.state === "installed" && navigator.serviceWorker.controller) offerUpdate(installing);
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (!cancelled) watch(registration);
      })
      .catch(() => {
        // An unregistrable worker costs the offline page and the shell cache.
        // Everything else about the app works, so this stays quiet.
      });

    // The new worker took over: reload once, so the page and its assets match.
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [t]);

  return null;
}

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
 */
export function ServiceWorkerRegistrar() {
  const t = useTranslations("pwa");

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
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

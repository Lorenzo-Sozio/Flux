"use client";

import { useEffect } from "react";

import { savePushSubscription } from "@/actions/push";

/**
 * Keeps a device's push subscription and the server's copy of it in step.
 *
 * ⚠️ A subscription is not permanent, and every way it can go out of date is
 * silent:
 *
 *   • The browser rotates it on its own — a `pushsubscriptionchange`, which the
 *     service worker answers by re-subscribing with the same application key.
 *     The new endpoint is then unknown to the server until something tells it.
 *   • A push came back 410 once, wrongly or during an outage, and the row was
 *     deleted. The browser still holds a perfectly good subscription that
 *     nothing will ever write to again.
 *   • Two people share a computer. The subscription belongs to the browser, not
 *     to the account, so after a sign-out and a sign-in it is pointing at the
 *     previous person's row.
 *
 * In every one of those the person turned notifications on, sees nothing that
 * says otherwise, and simply stops receiving anything. So on each new session
 * this re-sends what the browser holds. The action is an upsert on the endpoint,
 * so re-sending an unchanged subscription writes the same row back.
 *
 * Only when permission has already been granted: this must never be a path that
 * causes a prompt. And once per tab session, because it is a database write that
 * has nothing to do with the page being opened.
 */
const ONCE_PER_SESSION = "flux.push.synced";

/**
 * Deliberately silent. There is nobody to tell and nothing that should change:
 * the notification bell is unaffected, and the next page load tries again.
 */
function reportNothing() {
  /* Intentionally nothing. */
}

export function PushSubscriptionKeeper() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    try {
      if (sessionStorage.getItem(ONCE_PER_SESSION)) return;
    } catch {
      // A browser with storage blocked still deserves working notifications; it
      // just syncs on every mount instead of once.
    }

    let cancelled = false;

    const sync = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || cancelled) return;

      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys?.auth) return;

      await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: navigator.userAgent,
      });

      try {
        sessionStorage.setItem(ONCE_PER_SESSION, "1");
      } catch {
        // Nothing to do — see above.
      }
    };

    // Failure here is not the page's problem: the notification bell is
    // unaffected and the next load tries again.
    void sync().catch(reportNothing);

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "PUSH_SUBSCRIPTION_CHANGED") return;
      try {
        sessionStorage.removeItem(ONCE_PER_SESSION);
      } catch {
        // Nothing to do — see above.
      }
      void sync().catch(reportNothing);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}

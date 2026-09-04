"use client";

import { useEffect, useRef } from "react";

/**
 * Polling that stops when nobody is looking, and slows down when nothing happens.
 *
 * The product asked the server the same questions on a fixed timer regardless of
 * anything: notifications every minute, the chat conversation list every ten
 * seconds and the open conversation every five, forever, in every tab, whether or
 * not the tab was in front of anyone (audit rilievo U-11). A user with the CRM
 * parked in a background tab all day was making thousands of pointless requests,
 * each one a database round trip in someone's Postgres.
 *
 * Three changes, none of which need an event stream:
 *
 *  • A hidden tab does not poll at all. Nothing it learns can be seen.
 *  • Becoming visible polls immediately, so coming back to the tab is not a wait.
 *  • A tick that finds nothing backs off, up to a ceiling; a tick that finds
 *    something resets to the fast rate. Quiet periods cost little and busy ones
 *    stay responsive.
 *
 * `tick` returns whether it found anything. Returning `false` from a tick that
 * failed is right: a failure is not news.
 */
export function useLivePoll(
  tick: () => Promise<boolean>,
  options: { baseMs?: number; maxMs?: number; enabled?: boolean } = {},
): void {
  const { baseMs = 30_000, maxMs = 5 * 60_000, enabled = true } = options;

  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = baseMs;
    let live = true;

    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    };

    async function run() {
      if (!live) return;

      // A hidden tab learns nothing anyone can see. Check back at the ceiling
      // rather than stopping outright, so a tab that is never focused again still
      // eventually catches up without the visibility event.
      if (hidden()) {
        schedule(maxMs);
        return;
      }

      let found = false;
      try {
        found = await tickRef.current();
      } catch {
        // A failed poll is not news, and not a reason to hammer the server either.
        found = false;
      }
      if (!live) return;

      delay = found ? baseMs : Math.min(maxMs, delay * 2);
      schedule(delay);
    }

    const onVisible = () => {
      if (hidden() || !live) return;
      // Back from a background tab: answer now, at the fast rate.
      delay = baseMs;
      schedule(0);
    };

    document.addEventListener("visibilitychange", onVisible);
    schedule(baseMs);

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [baseMs, maxMs, enabled]);
}

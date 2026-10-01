"use client";

import { useEffect, useRef, useState } from "react";

import { usePathname, useSearchParams } from "next/navigation";

/** Past this, a navigation that never arrived stops showing progress. */
const GIVE_UP_MS = 15_000;

/**
 * A thin bar along the top of the screen from the moment an internal link is followed until the new
 * page is on screen. Without it a tap on a slow page answered nothing at all — the old page stayed,
 * frozen, and the obvious move was to tap again.
 *
 * Started by any click on a same-origin link (a list row, a menu entry, a record's link), ended by
 * the address changing. Clicks that do not navigate here — a new tab, a modifier key, the same
 * address, a download — start nothing.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The address changed: the page arrived.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every change of the address on purpose
  useEffect(() => {
    setState((s) => (s === "running" ? "done" : s));
  }, [pathname, searchParams]);

  useEffect(() => {
    if (state !== "done") return;
    const t = setTimeout(() => setState("idle"), 250);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // ⚠️ Not `defaultPrevented`: Next's Link prevents every click it turns into a navigation.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setState("running");
      if (giveUp.current) clearTimeout(giveUp.current);
      giveUp.current = setTimeout(() => setState("idle"), GIVE_UP_MS);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (giveUp.current) clearTimeout(giveUp.current);
    };
  }, []);

  if (state === "idle") return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <div
        className={
          state === "running"
            ? "h-full w-full origin-left animate-[nav-progress_8s_cubic-bezier(0.1,0.7,0.2,1)_forwards] bg-primary"
            : "h-full w-full origin-left bg-primary opacity-0 transition-opacity duration-200"
        }
      />
    </div>
  );
}

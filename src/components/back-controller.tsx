"use client";

import { useEffect, useRef, useState } from "react";

import { usePathname, useRouter } from "next/navigation";

import { backIsControlled, backLayers } from "@/hooks/use-back-dismiss";
import { type BackStep, catchesBack, createHistoryMirror, planBack } from "@/lib/back-plan";
import { backTargetOf, HOME_PATH } from "@/navigation/back-target";

/** The part of the CloseWatcher API this uses (Chrome 120+, Android's Back). */
interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}

/**
 * The phone's Back button, for the whole dashboard: one CloseWatcher, armed whenever Back has
 * something to do in the app, and on Back the step src/lib/back-plan.ts decides — close the top
 * layer, go up a level, go home. On the home with nothing open it is disarmed, and the system's Back
 * closes the app.
 *
 * Only where the browser has CloseWatcher, on a phone; elsewhere it renders nothing and the layers
 * use the history fallback in use-back-dismiss.ts.
 */
export function BackController() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [layers, setLayers] = useState(0);
  // Bumped after every Back, so the watcher is armed again even when nothing visible changed.
  const [round, setRound] = useState(0);
  const mirror = useRef<ReturnType<typeof createHistoryMirror> | null>(null);
  const watcher = useRef<CloseWatcherLike | null>(null);
  /** A `history.go` this made, and what to do once it has landed. */
  const ownStep = useRef<{ delta: number; after?: () => void } | null>(null);

  useEffect(() => setActive(backIsControlled()), []);
  useEffect(() => backLayers.subscribe(() => setLayers(backLayers.count)), []);

  // What is behind the current entry: the browser does not say, so every move is mirrored.
  useEffect(() => {
    if (!active) return;
    const m = createHistoryMirror(window.location.pathname);
    mirror.current = m;
    const push = window.history.pushState;
    const replace = window.history.replaceState;
    // Wrapped, not replaced: Next patches these two as well, and both run.
    window.history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = push.apply(this, args);
      m.push(window.location.pathname);
      return result;
    };
    window.history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
      const result = replace.apply(this, args);
      m.replace(window.location.pathname);
      return result;
    };
    const onPop = () => {
      const step = ownStep.current;
      ownStep.current = null;
      if (step) {
        m.went(step.delta);
        step.after?.();
      } else {
        m.landed(window.location.pathname);
      }
      setRound((r) => r + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.history.pushState = push;
      window.history.replaceState = replace;
      mirror.current = null;
    };
  }, [active]);

  // Armed while Back has something to do in the app; disarmed on the home with nothing open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluated on every change that moves the plan
  useEffect(() => {
    const m = mirror.current;
    if (!active || !m) return;
    const state = () => ({
      layers: backLayers.count,
      pathname: window.location.pathname,
      entries: m.entries,
      index: m.index,
      home: HOME_PATH,
      above: backTargetOf,
    });

    const act = (step: BackStep) => {
      if (step.kind === "close") backLayers.closeTop();
      else if (step.kind === "replace") router.replace(step.to);
      else if (step.kind === "go") {
        ownStep.current = {
          delta: step.delta,
          // Down to the start of the history: whatever opened the app becomes the home.
          after:
            step.finish === "home"
              ? () => window.location.pathname !== HOME_PATH && router.replace(HOME_PATH)
              : undefined,
        };
        window.history.go(step.delta);
      }
    };

    const needed = catchesBack(state());
    if (needed && !watcher.current) {
      const Watcher = (window as unknown as { CloseWatcher: new () => CloseWatcherLike }).CloseWatcher;
      try {
        const w = new Watcher();
        w.onclose = () => {
          watcher.current = null;
          act(planBack(state()));
          setRound((r) => r + 1);
        };
        watcher.current = w;
      } catch {
        // A browser that refuses another watcher: Back stays the system's for now.
      }
    } else if (!needed && watcher.current) {
      watcher.current.destroy();
      watcher.current = null;
    }
  }, [active, pathname, layers, round, router]);

  useEffect(
    () => () => {
      watcher.current?.destroy();
      watcher.current = null;
    },
    [],
  );

  return null;
}

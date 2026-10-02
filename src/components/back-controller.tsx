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

const DEBUG_KEY = "flux-back-debug";

/** Whether the person is interacting right now (a tap a moment ago), where the browser says. */
function hasActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : true;
}

/**
 * The phone's Back button, for the whole dashboard: one CloseWatcher, armed whenever Back has
 * something to do in the app, and on Back the step src/lib/back-plan.ts decides — close the top
 * layer, go up a level, go home. On the home with nothing open it is disarmed, and the system's Back
 * closes the app.
 *
 * ⚠️⚠️ **Re-armed at every tap when it was armed without one.** After a Back the watcher is made again
 * at once, with no tap behind it, and Chrome on Android may let a watcher made that way go unheard:
 * the first Back worked, every later one did nothing (2 October 2026). A watcher made during a tap
 * is one the browser honours, so the next tap replaces it.
 *
 * `?backdebug=1` shows what it does, in a box at the top of the screen (`?backdebug=0` hides it):
 * the way to see on a real phone what no desktop browser reproduces.
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
  const [debug, setDebug] = useState<string[] | null>(null);
  const mirror = useRef<ReturnType<typeof createHistoryMirror> | null>(null);
  const watcher = useRef<{ w: CloseWatcherLike; withTap: boolean } | null>(null);
  /** A `history.go` this made, and what to do once it has landed. */
  const ownStep = useRef<{ delta: number; after?: () => void } | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;

  const log = useRef((line: string) => {
    setDebug((prev) => (prev ? [...prev.slice(-11), `${new Date().toLocaleTimeString()} ${line}`] : prev));
  }).current;

  useEffect(() => {
    setActive(backIsControlled());
    try {
      const asked = new URLSearchParams(window.location.search).get("backdebug");
      if (asked === "1") localStorage.setItem(DEBUG_KEY, "1");
      if (asked === "0") localStorage.removeItem(DEBUG_KEY);
      if (localStorage.getItem(DEBUG_KEY) === "1")
        setDebug([`controller: ${backIsControlled() ? "CloseWatcher" : "not available"}`]);
    } catch {
      // No storage: no diagnostics.
    }
  }, []);
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
      log(`popstate ${step ? "(own)" : "(not own)"} → ${window.location.pathname} [${m.index}/${m.entries.length}]`);
      setRound((r) => r + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.history.pushState = push;
      window.history.replaceState = replace;
      mirror.current = null;
    };
  }, [active, log]);

  /** Where Back stands now, and what to do on it. Read fresh at each use: never a stale closure. */
  const now = () => {
    const m = mirror.current;
    if (!m) return null;
    return {
      layers: backLayers.count,
      pathname: window.location.pathname,
      entries: m.entries,
      index: m.index,
      home: HOME_PATH,
      above: backTargetOf,
    };
  };

  const act = (step: BackStep) => {
    if (step.kind === "close") backLayers.closeTop();
    else if (step.kind === "replace") routerRef.current.replace(step.to);
    else if (step.kind === "go") {
      ownStep.current = {
        delta: step.delta,
        // Down to the start of the history: whatever opened the app becomes the home.
        after:
          step.finish === "home"
            ? () => window.location.pathname !== HOME_PATH && routerRef.current.replace(HOME_PATH)
            : undefined,
      };
      window.history.go(step.delta);
    }
  };

  const disarm = () => {
    watcher.current?.w.destroy();
    watcher.current = null;
  };

  /** One watcher, made now; the old one, if any, goes first. */
  const arm = () => {
    disarm();
    const Watcher = (window as unknown as { CloseWatcher: new () => CloseWatcherLike }).CloseWatcher;
    try {
      const w = new Watcher();
      const withTap = hasActivation();
      w.onclose = () => {
        if (watcher.current?.w === w) watcher.current = null;
        const state = now();
        if (!state) return;
        const step = planBack(state);
        log(
          `Back → ${step.kind}${step.kind === "replace" ? ` ${step.to}` : step.kind === "go" ? ` ${step.delta}` : ""}`,
        );
        act(step);
        setRound((r) => r + 1);
      };
      watcher.current = { w, withTap };
      log(`armed (${withTap ? "with a tap" : "no tap"}) on ${window.location.pathname}, layers ${backLayers.count}`);
    } catch (error) {
      log(`arm failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const armRef = useRef(arm);
  armRef.current = arm;
  const nowRef = useRef(now);
  nowRef.current = now;

  // Armed while Back has something to do in the app; disarmed on the home with nothing open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluated on every change that moves the plan
  useEffect(() => {
    if (!active) return;
    const state = now();
    if (!state) return;
    const needed = catchesBack(state);
    if (needed && !watcher.current) arm();
    else if (!needed && watcher.current) {
      disarm();
      log(`disarmed on ${state.pathname}`);
    }
  }, [active, pathname, layers, round]);

  // A tap is what makes a watcher one the browser honours: one armed without a tap is made again.
  useEffect(() => {
    if (!active) return;
    const onTap = () => {
      const state = nowRef.current();
      if (!state || !catchesBack(state)) return;
      if (watcher.current && !watcher.current.withTap) armRef.current();
    };
    document.addEventListener("click", onTap, true);
    document.addEventListener("keydown", onTap, true);
    return () => {
      document.removeEventListener("click", onTap, true);
      document.removeEventListener("keydown", onTap, true);
    };
  }, [active]);

  useEffect(() => () => watcher.current?.w.destroy(), []);

  if (!debug) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-2 top-[calc(var(--safe-top)+3.5rem)] z-[2147483647] rounded-md bg-black/80 p-2 font-mono text-[10px] text-white leading-tight"
    >
      {debug.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a log, lines never move
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

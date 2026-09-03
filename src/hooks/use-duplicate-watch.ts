"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Looks for an existing record while the identifying field is still being typed.
 *
 * The duplicate check ran only on submit (audit rilievo U-13), which is the worst
 * moment to be told: every tab of the form is already filled in, and the answer —
 * "this person is already here" — means all of it was wasted. The same query costs
 * nothing to run early, when the reply is still useful and the user can open the
 * existing record instead.
 *
 * Two things keep it from being noise. It waits until typing stops, so it does not
 * fire per keystroke. And a reply that arrives after the keys have moved on is
 * dropped rather than shown, so the warning always describes what is on screen.
 */
export function useDuplicateWatch<T>(
  lookup: () => Promise<T[]>,
  keys: (string | null | undefined)[],
  options: { delayMs?: number; minLength?: number; enabled?: boolean } = {},
): { matches: T[]; checking: boolean; dismiss: () => void } {
  const { delayMs = 400, minLength = 3, enabled = true } = options;

  const [matches, setMatches] = useState<T[]>([]);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Held in a ref so a fresh closure on every render does not restart the timer.
  // Only the keys decide when to look.
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  const signature = keys.map((k) => k?.trim() ?? "").join(" ");
  const hasEnoughToGoOn = keys.some((k) => (k?.trim().length ?? 0) >= minLength);

  useEffect(() => {
    if (!enabled || !hasEnoughToGoOn || signature === dismissed) {
      setMatches([]);
      setChecking(false);
      return;
    }

    let live = true;
    setChecking(true);

    const timer = setTimeout(() => {
      lookupRef
        .current()
        .then((found) => {
          if (live) setMatches(found);
        })
        .catch(() => {
          // A failed probe is not worth interrupting anyone for: the check on save
          // is still there, and it is the one that has to be right.
          if (live) setMatches([]);
        })
        .finally(() => {
          if (live) setChecking(false);
        });
    }, delayMs);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [signature, enabled, hasEnoughToGoOn, delayMs, dismissed]);

  return {
    matches,
    checking,
    // Dismissing is per-value: change the field and the warning comes back, which
    // is right, because it is then about a different record.
    dismiss: () => setDismissed(signature),
  };
}

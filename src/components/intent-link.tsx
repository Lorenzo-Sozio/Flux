"use client";

import { type ComponentProps, useState } from "react";

import Link, { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

/**
 * A link that prefetches when somebody shows they mean to follow it — the pointer over it, a finger
 * on it, the keyboard on it — instead of never (`prefetch={false}`, which every menu link had: each
 * tap was a cold trip to the server with the old page frozen meanwhile) or as soon as it is on
 * screen (a sidebar of forty links would prefetch forty pages on every load, each a Worker request).
 *
 * The prefetch of a dynamic page is its shell down to the nearest `loading.tsx`: the skeleton is on
 * screen at the tap, and the page streams into it.
 *
 * An explicit `prefetch` is honoured as given.
 */
export function IntentLink({ prefetch, onMouseEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  if (prefetch !== undefined) {
    return (
      <Link prefetch={prefetch} onMouseEnter={onMouseEnter} onTouchStart={onTouchStart} onFocus={onFocus} {...props} />
    );
  }
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onMouseEnter={(event) => {
        setIntent(true);
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        onTouchStart?.(event);
      }}
      onFocus={(event) => {
        setIntent(true);
        onFocus?.(event);
      }}
    />
  );
}

/**
 * Inside a link: a dot that pulses while the page it leads to is on its way, so a tap is answered at
 * once even when the server is not.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none size-1.5 shrink-0 rounded-full bg-primary transition-opacity duration-150",
        pending ? "animate-pulse opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}

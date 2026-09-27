"use client";

import { useRef } from "react";

import { useRouter } from "next/navigation";

/**
 * A sideways swipe moves the calendar to the next or previous day, week or
 * month — on a phone, the gesture every calendar app has taught people to try
 * before looking for an arrow.
 *
 * ⚠️ It stays out of the way of everything else a finger does here:
 * - a mostly vertical movement is scrolling, and is never taken for a swipe;
 * - a swipe that starts inside something that scrolls sideways (a row of view
 *   buttons, a board) belongs to that element;
 * - anything marked `data-no-swipe` opts out;
 * - from md up there is a mouse and there are arrows, and nothing happens.
 */
export function SwipeNav({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string;
  nextHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    start.current = null;
    if (e.touches.length !== 1 || !window.matchMedia("(max-width: 767px)").matches) return;
    let el = e.target as HTMLElement | null;
    while (el && el !== e.currentTarget) {
      if (el.dataset.noSwipe !== undefined) return;
      const overflowX = getComputedStyle(el).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4) return;
      el = el.parentElement;
    }
    const touch = e.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - s.x;
    const dy = touch.clientY - s.y;
    // Far enough, clearly sideways, and quick: a flick, not a slow drag.
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - s.t > 700) return;
    router.push(dx < 0 ? nextHref : prevHref, { scroll: false });
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        start.current = null;
      }}
    >
      {children}
    </div>
  );
}

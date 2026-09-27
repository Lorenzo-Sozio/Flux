"use client";

import { useEffect, useRef } from "react";

/**
 * Opens a time grid at the hour that matters — now, today; otherwise the first
 * thing on it — instead of at whatever hour the grid happens to start.
 *
 * The grid is stretched to take in a meeting at six in the morning, and without
 * this it then opened on six in the morning every day of that week, with the
 * working day below the fold.
 *
 * From md up the grid has its own scroll area, marked `data-cal-scroll`, and only
 * that moves. On a phone the grid does not scroll — the page does — so with
 * `pageFallback` the page is moved instead, stopping `stickyOffset` pixels short
 * so the hour lands under the sticky week strip rather than behind it. It only
 * ever moves forward: a page already scrolled past the hour is the reader's.
 */
export function GridAutoScroll({
  offsetPx,
  pageFallback = false,
  stickyOffset = 0,
}: {
  offsetPx: number;
  pageFallback?: boolean;
  stickyOffset?: number;
}) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const own = marker.current?.closest<HTMLElement>("[data-cal-scroll]");
    if (own) {
      const overflowY = getComputedStyle(own).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && own.scrollHeight > own.clientHeight) {
        own.scrollTop = Math.max(0, offsetPx);
        return;
      }
    }
    if (!pageFallback || !marker.current || !window.matchMedia("(max-width: 767px)").matches) return;

    // The page's own scroll area: the nearest ancestor that actually scrolls.
    let scroller = marker.current.parentElement;
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const markerTop =
      marker.current.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const target = markerTop + offsetPx - stickyOffset;
    // Not worth a jump for the first hour or two of the grid.
    if (target > scroller.scrollTop + 120) scroller.scrollTo({ top: target, behavior: "smooth" });
  }, [offsetPx, pageFallback, stickyOffset]);

  // Zero-sized rather than `hidden`: a hidden element has no position to measure.
  return <span ref={marker} aria-hidden className="pointer-events-none absolute top-0 left-0 size-0" />;
}

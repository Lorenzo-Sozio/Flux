"use client";

import Link from "next/link";

import { HOME_VIEW_COOKIE, type HomeView } from "@/lib/home-view";

/**
 * "Me | Company". The link carries the view, so the server renders it; the click also
 * remembers it for this browser, so the next visit to the home opens where the person left.
 * A cookie rather than localStorage because the server has to read it to render the page.
 */
export function HomeViewToggle({
  view,
  label,
  labels,
}: {
  view: HomeView;
  label: string;
  labels: Record<HomeView, string>;
}) {
  const remember = (v: HomeView) => {
    // A year; scoped to the dashboard, which is the only place that reads it.
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing from older Safari, and the server must read this.
    document.cookie = `${HOME_VIEW_COOKIE}=${v}; path=/dashboard; max-age=31536000; samesite=lax`;
  };

  return (
    <nav aria-label={label} className="flex shrink-0 rounded-md border p-0.5">
      {(["me", "company"] as const).map((v) => (
        <Link
          key={v}
          href={`/dashboard/crm?view=${v}`}
          onClick={() => remember(v)}
          aria-current={view === v ? "page" : undefined}
          className={`rounded px-3 py-1 text-sm ${view === v ? "bg-muted font-medium" : "text-muted-foreground"}`}
        >
          {labels[v]}
        </Link>
      ))}
    </nav>
  );
}

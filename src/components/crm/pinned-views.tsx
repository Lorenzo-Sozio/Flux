"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Pin } from "lucide-react";
import { useTranslations } from "next-intl";

import { encodeFilter, type FilterTree } from "@/lib/filter-types";
import { cn } from "@/lib/utils";

type View = { id: string; name: string; criteria: string; isPinned: boolean };

/** A view's filter as the URL carries it, or null for one that no longer reads. */
function encoded(criteria: string): string | null {
  try {
    const tree = JSON.parse(criteria) as FilterTree;
    return tree?.version === 1 ? encodeFilter(tree) : null;
  } catch {
    return null;
  }
}

/**
 * The pinned views above a list: "My leads nobody has touched", "Closing this month" — one
 * tap each (§4.5). A person's own pinned views and the ones colleagues shared and pinned.
 * Chips that wrap: never a row that scrolls sideways on a phone.
 */
export function PinnedViews({ views, basePath }: { views: View[]; basePath: string }) {
  const t = useTranslations("filterBuilder.presets");
  const params = useSearchParams();
  const current = params.get("filter");
  const pinned = views
    .filter((v) => v.isPinned)
    .map((v) => ({ ...v, filter: encoded(v.criteria) }))
    .filter((v): v is typeof v & { filter: string } => v.filter !== null);
  if (pinned.length === 0) return null;
  return (
    <nav aria-label={t("pinnedLabel")} className="mb-3 flex flex-wrap gap-1.5">
      {pinned.map((v) => {
        const active = current === v.filter;
        return (
          <Link
            key={v.id}
            href={active ? basePath : `${basePath}?filter=${encodeURIComponent(v.filter)}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
              active ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Pin className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{v.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

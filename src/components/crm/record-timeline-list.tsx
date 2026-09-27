"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { FileTextIcon, HistoryIcon, StickyNoteIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { loadMoreTimelineAction } from "@/actions/timeline";
import { FormattedDate } from "@/components/crm/formatted-date";
import {
  ACTIVITY_ICON_BG,
  ACTIVITY_ICONS,
  TimelineActivityCard,
  viaHref,
} from "@/components/crm/timeline-activity-card";
import { Button } from "@/components/ui/button";
import type { TimelineItem, TimelineScope } from "@/lib/record-timeline";
import { cn } from "@/lib/utils";

type Filter = "all" | "activity" | "change" | "quote";
const FILTERS: Filter[] = ["all", "activity", "change", "quote"];

/** Values stored as ISO dates, shown as dates. */
const DATE_FIELDS = new Set(["expectedCloseDate"]);

export function RecordTimelineList({
  scope,
  initial,
  revalidatePathStr,
  canWrite,
}: {
  scope: TimelineScope;
  initial: { items: TimelineItem[]; hasMore: boolean };
  revalidatePathStr: string;
  canWrite: boolean;
}) {
  const t = useTranslations("recordTimeline");
  const format = useFormatter();
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, startTransition] = useTransition();

  const loadMore = () =>
    startTransition(async () => {
      const last = items[items.length - 1];
      if (!last) return;
      try {
        const next = await loadMoreTimelineAction(scope, last.at);
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.key));
          return [...prev, ...next.items.filter((i) => !seen.has(i.key))];
        });
        setHasMore(next.hasMore);
      } catch {
        toast.error(t("loadFailed"));
      }
    });

  const fieldLabel = (field: string) => (t.has(`fields.${field}`) ? t(`fields.${field}` as never) : field);
  const shownValue = (field: string, raw: string | null, label: string | null) => {
    if (raw === null) return t("empty");
    if (label) return label;
    if (DATE_FIELDS.has(field))
      return format.dateTime(new Date(raw), { day: "numeric", month: "short", year: "numeric" });
    if (field === "amount") return format.number(Number(raw), { maximumFractionDigits: 2 });
    if (field === "probability") return `${raw}%`;
    if (field === "marketingConsent") return t(raw === "true" ? "consentGiven" : "consentWithdrawn");
    if (field === "status" && t.has(`statuses.${raw}`)) return t(`statuses.${raw}` as never);
    return raw;
  };

  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);

  if (items.length === 0) {
    return <p className="py-8 text-center text-muted-foreground text-sm">{t("nothing")}</p>;
  }

  return (
    <div className="space-y-3">
      {/* ⚠️ Chips that wrap, never a row that scrolls sideways on a phone. */}
      <fieldset className="flex flex-wrap gap-1.5" aria-label={t("filterLabel")}>
        {FILTERS.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={filter === f ? "secondary" : "ghost"}
            aria-pressed={filter === f}
            className="h-7 px-2.5 text-xs"
            onClick={() => setFilter(f)}
          >
            {t(`filters.${f}`)}
          </Button>
        ))}
      </fieldset>

      {shown.length === 0 && <p className="py-4 text-center text-muted-foreground text-sm">{t("nothingOfKind")}</p>}

      <div className="relative">
        {/* The rail and its dots from sm up; below, each card's chip carries the same icon. */}
        <div
          className="pointer-events-none absolute top-5 bottom-5 left-[15px] hidden w-px bg-border sm:block"
          aria-hidden
        />
        <ol className="space-y-3">
          {shown.map((item) => (
            <li key={item.key} className="relative flex gap-3">
              <Dot item={item} />
              {item.kind === "activity" ? (
                <TimelineActivityCard
                  activity={item}
                  revalidatePathStr={revalidatePathStr}
                  canWrite={canWrite}
                  onDeleted={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                />
              ) : item.kind === "change" ? (
                <div className="min-w-0 flex-1 py-1.5 text-sm">
                  <p className="break-words">
                    {t.rich("changed", {
                      who: item.byName ?? t("someone"),
                      field: fieldLabel(item.field),
                      b: (chunks) => <strong className="font-medium">{chunks}</strong>,
                    })}{" "}
                    <span className="text-muted-foreground line-through">
                      {shownValue(item.field, item.oldValue, item.oldLabel)}
                    </span>{" "}
                    → <span className="font-medium">{shownValue(item.field, item.newValue, item.newLabel)}</span>
                  </p>
                  <Meta item={item} />
                </div>
              ) : (
                <div className="min-w-0 flex-1 py-1.5 text-sm">
                  <p className="break-words">
                    <Link href={`/dashboard/sales/quotes/${item.quoteId}`} className="font-medium hover:underline">
                      {item.quoteNumber}
                    </Link>{" "}
                    {t.has(`quoteEvents.${item.event}`) ? t(`quoteEvents.${item.event}` as never) : item.event}
                    {item.byName ? ` · ${item.byName}` : ""}
                  </p>
                  <Meta item={item} />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
            {pending ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Dot({ item }: { item: TimelineItem }) {
  const Icon =
    item.kind === "activity"
      ? (ACTIVITY_ICONS[item.type] ?? StickyNoteIcon)
      : item.kind === "change"
        ? HistoryIcon
        : FileTextIcon;
  const cls =
    item.kind === "activity"
      ? (ACTIVITY_ICON_BG[item.type] ?? ACTIVITY_ICON_BG.note)
      : "bg-muted text-muted-foreground";
  return (
    <div
      className={cn(
        "relative z-10 hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ring-2 ring-background sm:flex",
        cls,
      )}
    >
      <Icon className="h-4 w-4" />
    </div>
  );
}

function Meta({ item }: { item: TimelineItem }) {
  const t = useTranslations("recordTimeline");
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs">
      <FormattedDate date={item.at} />
      {item.via && (
        <Link href={viaHref(item.via)} className="text-primary hover:underline">
          {t("via", { name: item.via.name })}
        </Link>
      )}
    </p>
  );
}

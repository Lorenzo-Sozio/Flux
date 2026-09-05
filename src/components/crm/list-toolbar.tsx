"use client";

/**
 * The controls a list needs to be usable past the first fifty rows: a search box,
 * a page size, and the pager.
 *
 * All of it lives in the URL rather than in component state, so a filtered,
 * sorted, paged list can be sent to a colleague and survives the back button.
 */
import { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/pagination";

interface Props {
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** Rows on this page, so the summary can say what is on screen. */
  shown: number;
  searchPlaceholder?: string;
}

export function ListToolbar({ total, page, pageCount, pageSize, shown, searchPlaceholder }: Props) {
  const t = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.get("q") ?? "";
  const [term, setTerm] = useState(currentSearch);

  // Keep the box in step when the user navigates back to a different search.
  useEffect(() => setTerm(currentSearch), [currentSearch]);

  /** Builds the next URL, always dropping the page — a new search starts at one. */
  const hrefWith = (changes: Record<string, string | null>, keepPage = false): string => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!keepPage) next.delete("page");
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  const submitSearch = (value: string) => {
    startTransition(() => router.push(hrefWith({ q: value.trim() || null })));
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + shown;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Full width on a phone: the search box is the toolbar's reason to exist,
          and 224px beside a page-size select and two arrows leaves room for
          about four characters. */}
      <form
        className="relative w-full sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch(term);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={searchPlaceholder ?? t("search")}
          className="h-9 w-full pr-8 pl-8 sm:w-56"
          aria-label={searchPlaceholder ?? t("search")}
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              submitSearch("");
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={t("clear")}
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

      <div className="hidden flex-1 sm:block" />

      <span className="mr-auto text-muted-foreground text-xs tabular-nums sm:mr-0">
        {t("listRange", { from, to, total })}
      </span>

      <Select
        value={String(pageSize)}
        onValueChange={(v) =>
          startTransition(() => router.push(hrefWith({ size: v === String(DEFAULT_PAGE_SIZE) ? null : v })))
        }
      >
        <SelectTrigger className="h-9 w-[84px]" aria-label={t("rowsPerPage")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-9" disabled={page <= 1} asChild={page > 1}>
          {page > 1 ? (
            <Link href={hrefWith({ page: page - 1 === 1 ? null : String(page - 1) }, true)} aria-label={t("previous")}>
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </Button>

        <span className="px-1 text-xs tabular-nums">{t("pageOf", { page, pageCount })}</span>

        <Button
          variant="outline"
          size="icon"
          className="size-9"
          disabled={page >= pageCount}
          asChild={page < pageCount}
        >
          {page < pageCount ? (
            <Link href={hrefWith({ page: String(page + 1) }, true)} aria-label={t("next")}>
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

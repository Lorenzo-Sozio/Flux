"use client";

import { useEffect, useState, useTransition } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Check, ChevronDown, Loader2, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type CalendarFilter, PERSON_STYLES, peopleFilter, peopleOf } from "@/lib/calendar-filter";
import { cn } from "@/lib/utils";

export type CalendarPerson = { id: string; name: string | null; email: string | null; former: boolean };

const COMPACT_QUERY = "(max-width: 767px)";

/**
 * Whose calendar: everybody, me, my group, or any colleagues by name.
 *
 * A popover on a desktop and a sheet from the bottom on a phone, with the same
 * contents. A tick applies at once, as the pipeline's agent filter does: each is one
 * narrowing the calendar answers straight away. With two people or more each gets a
 * colour, shown beside their name here and on their events.
 */
export function CalendarPeopleFilter({
  filter,
  people,
  meId,
}: {
  filter: CalendarFilter;
  people: CalendarPerson[];
  meId: string | null;
}) {
  const t = useTranslations("calendar.people");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const mql = window.matchMedia(COMPACT_QUERY);
    const apply = () => setCompact(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  const chosen = peopleOf(filter) ?? [];
  const name = (p: CalendarPerson) => p.name || p.email || t("unnamed");

  const go = (next: CalendarFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("filter");
    else params.set("filter", next);
    // An appointment open in the side sheet may not be among the new person's.
    params.delete("appointment");
    params.delete("occurrence");
    const q = params.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };

  const toggle = (id: string) =>
    go(peopleFilter(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]));

  const summary =
    filter === "mine"
      ? t("me")
      : filter === "group"
        ? t("group")
        : chosen.length === 0
          ? t("everybody")
          : chosen.length === 1
            ? (() => {
                const p = people.find((x) => x.id === chosen[0]);
                return p ? name(p) : t("count", { count: 1 });
              })()
            : t("count", { count: chosen.length });

  const q = search.trim().toLocaleLowerCase();
  const visible = people.filter(
    (p) => !q || name(p).toLocaleLowerCase().includes(q) || (p.email ?? "").toLocaleLowerCase().includes(q),
  );

  const preset = (value: CalendarFilter, label: string) => {
    const on = filter === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={on}
        onClick={() => go(value)}
        className={cn(
          "flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-md px-2 text-center font-medium text-sm leading-tight transition-colors",
          on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {label}
      </button>
    );
  };

  const body = (
    <div className="flex min-h-0 flex-col">
      <div className="flex gap-1 rounded-lg border p-1">
        {preset("all", t("everybody"))}
        {preset("mine", t("me"))}
        {preset("group", t("group"))}
      </div>
      <p className="mt-4 mb-2 font-medium text-muted-foreground text-xs">{t("colleagues")}</p>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("search")}
        aria-label={t("search")}
        className="h-10 md:h-8 md:text-sm"
      />
      <ul className="mt-1 max-h-72 overflow-y-auto py-1">
        {visible.map((p) => {
          const at = chosen.indexOf(p.id);
          const style = at >= 0 && chosen.length > 1 ? PERSON_STYLES[at % PERSON_STYLES.length] : null;
          return (
            <li key={p.id}>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control */}
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted md:min-h-9">
                <Checkbox checked={at >= 0} onCheckedChange={() => toggle(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {name(p)}
                    {p.id === meId && <span className="text-muted-foreground"> · {t("you")}</span>}
                  </span>
                  {p.former ? (
                    <span className="block truncate text-muted-foreground text-xs">{t("former")}</span>
                  ) : (
                    p.name && p.email && <span className="block truncate text-muted-foreground text-xs">{p.email}</span>
                  )}
                </span>
                {style && <span className={cn("size-2.5 shrink-0 rounded-full", style.dot)} aria-hidden />}
              </label>
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-2 py-4 text-center text-muted-foreground text-sm">{t("none")}</li>}
      </ul>
    </div>
  );

  const trigger = (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-9 max-w-56 gap-1.5 px-2.5", filter !== "all" && "border-primary/50 bg-primary/5")}
      aria-label={t("label", { who: summary })}
      onClick={compact ? () => setOpen(true) : undefined}
    >
      <Users className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{summary}</span>
      {isPending ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin opacity-60" aria-hidden />
      ) : (
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      )}
    </Button>
  );

  if (compact) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[90dvh] pb-[var(--safe-bottom)]">
            <DrawerHeader className="text-left">
              <DrawerTitle>{t("title")}</DrawerTitle>
              <DrawerDescription>{t("hint")}</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 overflow-y-auto px-4">{body}</div>
            <DrawerFooter className="flex-row gap-2 border-t">
              <Button variant="outline" className="h-11 flex-1" onClick={() => go("all")} disabled={filter === "all"}>
                <X className="size-4" aria-hidden />
                {t("reset")}
              </Button>
              <Button className="h-11 flex-1" onClick={() => setOpen(false)}>
                <Check className="size-4" aria-hidden />
                {t("done")}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        {body}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Who wears which colour, when two people or more are on screen: a key, since the
 * colour on an event says nothing until it is matched to a name.
 */
export function CalendarPeopleLegend({ filter, people }: { filter: CalendarFilter; people: CalendarPerson[] }) {
  const t = useTranslations("calendar.people");
  const chosen = peopleOf(filter) ?? [];
  if (chosen.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
      {chosen.map((id, i) => {
        const p = people.find((x) => x.id === id);
        return (
          <li key={id} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", PERSON_STYLES[i % PERSON_STYLES.length].dot)} aria-hidden />
            {p?.name || p?.email || t("unnamed")}
          </li>
        );
      })}
    </ul>
  );
}

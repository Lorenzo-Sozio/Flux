"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface RecordTab {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown beside the label, so an empty tab is known to be empty before it is opened. */
  count?: number;
}

export interface RecordSection {
  /** Which tab shows it on a phone. */
  tab: string;
  /** Which column holds it from lg up: the work, or the reference beside it. */
  column: "main" | "side";
  node: ReactNode;
}

/**
 * Two columns on a desktop, one tab at a time on a phone.
 *
 * ⚠️⚠️ Every section is rendered once and only hidden, never mounted twice or
 * unmounted. The same node is the desktop card and the mobile tab, so a form half
 * typed on one survives a rotation to the other, and a client card that loads its
 * own data (documents, custom fields) loads it once. Hiding is `max-lg:hidden`, so
 * from lg up the classes do nothing and every section is on screen.
 *
 * Below lg a record used to be one column of every card the desktop shows side by
 * side — the contact page was about four screens of scrolling, and what somebody
 * opened it for was somewhere in the middle. The tabs put one subject on screen at
 * a time, with its count beside its name, and the hero above them stays the same.
 *
 * The chosen tab is kept in the URL fragment: a refresh, a server action's
 * revalidation or the back button from a linked record returns to it.
 */
export function RecordSections({
  tabs,
  sections,
  label,
}: {
  tabs: RecordTab[];
  sections: RecordSection[];
  /** The tab list's accessible name. */
  label: string;
}) {
  const visibleTabs = tabs.filter((t) => sections.some((s) => s.tab === t.id));
  const [active, setActive] = useState(visibleTabs[0]?.id ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Read after mount, not during render: the server has no fragment, and a first
  // render that disagreed with it would be a hydration mismatch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (visibleTabs.some((t) => t.id === fromHash)) setActive(fromHash);
  }, []);

  const choose = (id: string) => {
    setActive(id);
    try {
      window.history.replaceState(window.history.state, "", `#${id}`);
    } catch {
      // A sandboxed frame may refuse; the tab still changes.
    }
    // A tab chosen from far down the previous one starts at its own top, not
    // halfway through it — but only when the bar is stuck, i.e. has come apart
    // from the top of the block it opens; above that the page has not moved and
    // must not jump.
    const root = rootRef.current;
    const bar = barRef.current;
    if (root && bar && bar.getBoundingClientRect().top - root.getBoundingClientRect().top > 1) {
      root.scrollIntoView({ block: "start" });
    }
  };

  const column = (which: "main" | "side") =>
    sections
      .map((s, i) => ({ ...s, key: i }))
      .filter((s) => s.column === which)
      .map((s) => (
        // `empty:hidden`: a card that renders nothing (custom fields with no
        // definitions, a handover with nothing to hand over) would otherwise leave
        // its wrapper behind, and with it a double gap in the column.
        <div
          key={s.key}
          className={cn("min-w-0 empty:hidden", s.tab !== active && "max-lg:hidden")}
          data-record-tab={s.tab}
        >
          {s.node}
        </div>
      ));

  const main = column("main");
  const side = column("side");

  return (
    <div ref={rootRef} className="min-w-0">
      {visibleTabs.length > 1 && (
        <RecordTabBar ref={barRef} tabs={visibleTabs} active={active} onChange={choose} label={label} />
      )}

      {/*
        ⚠️ Side by side from lg, not md: at 768px the dashboard's own sidebar is
        still there, and a third of what it leaves is about 170px. The reference
        column is on the left on a desktop, as it always was on these pages; the
        work column is first in the source so a keyboard or a screen reader meets
        it first. Below lg both columns are `contents`: their cards become rows of
        the one-column grid, so a column whose every card is hidden leaves no gap.
      */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 sm:gap-6 lg:grid-cols-3">
        {main.length > 0 && (
          <div
            className={cn(
              "min-w-0 max-lg:contents lg:order-2 lg:flex lg:flex-col lg:gap-6",
              side.length > 0 ? "lg:col-span-2" : "lg:col-span-3",
            )}
          >
            {main}
          </div>
        )}
        {side.length > 0 && (
          <div
            className={cn(
              "min-w-0 max-lg:contents lg:order-1 lg:flex lg:flex-col lg:gap-6",
              main.length === 0 && "lg:col-span-3",
            )}
          >
            {side}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A form for adding to the section above it — a task, a note — folded behind one
 * button on a phone and open on a desktop.
 *
 * ⚠️ On a phone the task form alone was taller than the screen, so opening a
 * record's "To do" tab showed a form and not one of the things to do. Folded, the
 * list is what the tab shows, and the form is one tap away. The form stays
 * mounted while folded, like the sections, so a half-typed task survives.
 */
export function RecordComposer({
  label,
  icon,
  children,
}: {
  /** "New task", "Log activity": what pressing it does. */
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground lg:hidden [&_svg]:size-4",
          open && "mb-3 border-solid bg-muted text-foreground",
        )}
      >
        {icon}
        {label}
      </button>
      <div className={cn(!open && "max-lg:hidden")}>{children}</div>
    </div>
  );
}

/**
 * The segmented bar the phone layout switches subjects with: a record's sections,
 * or the sections of a long form. Sticky to whichever scroll container holds the
 * page, so the subjects stay one tap away however long the open one is. Hidden
 * from lg up, where everything is on screen at once.
 *
 * ⚠️ Equal columns, icon over label, never a sideways scroll. The bar was a row
 * of pills that ran off the right edge at four tabs, so the last subject on every
 * record was a half-word nobody knew was there. Five columns of ~70px fit a 360px
 * phone; from sm the label goes beside the icon again, where there is room.
 */
export function RecordTabBar({
  ref,
  tabs,
  active,
  onChange,
  label,
  invalid = [],
  sticky = true,
}: {
  ref?: React.Ref<HTMLDivElement>;
  /** False under a page that already pins its own bar to the top. */
  sticky?: boolean;
  tabs: RecordTab[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  /** Tabs holding a field that failed validation: marked, so the error can be found. */
  invalid?: string[];
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next =
      event.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`record-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div
      ref={ref}
      className={cn(
        "-mx-1 mb-3 bg-background/95 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mb-4 lg:hidden",
        sticky && "sticky top-0 z-20",
      )}
    >
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-muted p-1"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          const count = tab.count != null && tab.count > 0 ? tab.count : null;
          const hasError = invalid.includes(tab.id);
          return (
            <button
              key={tab.id}
              id={`record-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 font-medium text-[11px] leading-tight transition-colors sm:min-h-10 sm:flex-row sm:gap-1.5 sm:text-sm [&_svg]:size-[18px] [&_svg]:shrink-0 sm:[&_svg]:size-4",
                selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                hasError && "text-destructive",
              )}
            >
              <span className="relative flex">
                {tab.icon}
                {hasError ? (
                  <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-destructive" aria-hidden />
                ) : (
                  count !== null && (
                    <span
                      className={cn(
                        "absolute -top-1.5 left-3 min-w-4 rounded-full px-1 text-center font-semibold text-[10px] tabular-nums leading-4 sm:hidden",
                        selected ? "bg-primary text-primary-foreground" : "bg-muted-foreground/25 text-foreground",
                      )}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )
                )}
              </span>
              <span className="max-w-full truncate">{tab.label}</span>
              {count !== null && (
                <span
                  className={cn(
                    "hidden min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5 sm:inline",
                    selected ? "bg-primary/10 text-primary" : "bg-background/70",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

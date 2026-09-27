"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The pieces the task dialog is laid out with: the segmented section bar and the
 * section block. They copy the look of `RecordSections` rather than using it,
 * because a dialog is not a page.
 *
 * ⚠️ The chosen section is NOT kept in the URL fragment, as `RecordSections` keeps
 * its tab. This dialog opens on top of the deal, contact, company and lead pages,
 * whose own tabs live in that fragment: writing `#time` there would move the page
 * underneath to a tab it does not have, and closing the dialog would leave it there.
 */

export interface TaskDialogTab {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  /** A field in this section failed validation: a dot, so the error is found without opening every tab. */
  error?: boolean;
}

export function TaskDialogTabBar({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TaskDialogTab[];
  active: string;
  onChange: (id: string) => void;
  label: string;
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
    document.getElementById(`task-dialog-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none]"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`task-dialog-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative flex min-h-10 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
              // The icons go below sm: three Italian labels and a count are the whole
              // width of a 375px phone on their own.
              "max-sm:[&_svg]:hidden",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5",
                  selected ? "bg-primary/10 text-primary" : "bg-background/70",
                )}
              >
                {tab.count}
              </span>
            )}
            {tab.error && <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One subject of the dialog, with its heading. Framed only from lg up, where the
 * sections sit side by side like the cards of a record page; on a phone it is one
 * tab of a full-screen dialog, and a border there is only a narrower column.
 */
export function TaskDialogSection({
  title,
  icon,
  aside,
  framed,
  hidden,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** Beside the heading: a count, "3 of 5". */
  aside?: ReactNode;
  framed?: boolean;
  /** Not on the tab being shown. Hidden, never unmounted: a half-typed field survives a change of tab. */
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 space-y-3", framed && "lg:rounded-lg lg:border lg:p-4", hidden && "max-lg:hidden")}>
      <h3 className="flex min-w-0 items-center gap-1.5 font-semibold text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
        {icon}
        <span className="truncate">{title}</span>
        {aside != null && <span className="ml-auto shrink-0 font-normal text-muted-foreground text-xs">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

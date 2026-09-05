"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * A list of records, as cards, for screens too narrow to hold a table.
 *
 * ⚠️ This is **not** a responsive table. A nine-column list does not become
 * usable by scrolling sideways: the name goes off one edge, the column headings
 * go off the other, and the reader has to remember which column they were in
 * while they drag. Below `md` the same records are drawn as cards instead —
 * name and status on the first line, the two or three fields that identify a
 * record underneath, the whole card a link, and the row actions in the corner
 * where they do not fight the tap.
 *
 * The desktop table is left exactly as it was. Each list renders one or the
 * other, and neither is a compromise between them.
 */

export interface RecordCardField {
  label: string;
  /** Rendered only when truthy: a card of eight em-dashes says nothing. */
  value: ReactNode;
}

export interface RecordCardItem {
  id: string;
  href?: string;
  title: ReactNode;
  /** The one line under the title — an email, a company, a customer. */
  subtitle?: ReactNode;
  /** Top-right of the card: a status badge, an amount, a score. */
  badge?: ReactNode;
  fields?: RecordCardField[];
  /** The row's own menu. Sits outside the link, so a tap on it does not navigate. */
  actions?: ReactNode;
  /**
   * Controls along the bottom of the card, outside the link.
   *
   * For the things a list lets you change without opening the record — a status,
   * an assignee. They cannot go in the body: a `<select>` inside an `<a>` is
   * invalid, and a tap on it would navigate instead of opening.
   */
  footer?: ReactNode;
  selected?: boolean;
  onToggle?: () => void;
  selectLabel?: string;
}

function CardBody({ item }: { item: RecordCardItem }) {
  const fields = (item.fields ?? []).filter((f) => f.value !== null && f.value !== undefined && f.value !== "");

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{item.title}</p>
          {item.subtitle && <p className="mt-0.5 truncate text-muted-foreground text-xs">{item.subtitle}</p>}
        </div>
        {item.badge && <div className="shrink-0">{item.badge}</div>}
      </div>

      {fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="truncate text-[10px] text-muted-foreground uppercase tracking-wide">{field.label}</dt>
              <dd className="mt-0.5 truncate text-sm">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

export function RecordCards({ items, className }: { readonly items: RecordCardItem[]; readonly className?: string }) {
  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item) => {
        const selectable = Boolean(item.onToggle);

        return (
          <li
            key={item.id}
            className={cn(
              "relative rounded-lg border bg-card transition-colors",
              item.selected && "border-primary/40 bg-primary/5",
            )}
          >
            {/* The checkbox and the menu live outside the link: an anchor may not
                contain a button, and a tap meant for either must not navigate. */}
            {selectable && (
              <div className="absolute top-3 left-3 z-10">
                <Checkbox
                  checked={item.selected}
                  onCheckedChange={() => item.onToggle?.()}
                  aria-label={item.selectLabel}
                />
              </div>
            )}
            {item.actions && <div className="absolute top-1.5 right-1.5 z-10">{item.actions}</div>}

            {item.href ? (
              <Link
                href={item.href}
                className={cn("block rounded-lg p-3", selectable && "pl-11", item.actions && "pr-11")}
              >
                <CardBody item={item} />
              </Link>
            ) : (
              <div className={cn("p-3", selectable && "pl-11", item.actions && "pr-11")}>
                <CardBody item={item} />
              </div>
            )}

            {item.footer && <div className="flex items-center gap-2 border-t px-3 py-2">{item.footer}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Shows the cards below `md` and the table from `md` up.
 *
 * A wrapper rather than a convention, so a list cannot end up rendering both —
 * which is what happens the third time somebody copies the two `hidden` classes
 * by hand.
 */
export function ResponsiveRecordList({ cards, table }: { readonly cards: ReactNode; readonly table: ReactNode }) {
  return (
    <>
      <div className="md:hidden">{cards}</div>
      <div className="hidden md:block">{table}</div>
    </>
  );
}

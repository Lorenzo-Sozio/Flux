import type { ReactNode } from "react";

import Link from "next/link";

import { ChevronLeftIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The parts every record page is built from.
 *
 * One record, one screen, in the order of the questions somebody opening it asks:
 * what is it and what state is it in (the hero), the few figures that decide what
 * happens next (the metric strip), what to do about it (the work column), and the
 * reference material — who, where, the notes, the files — beside it (the side
 * column). The deal page was the first built this way; contacts, companies, leads,
 * orders and the rest follow it, so a rep who has learnt one has learnt them all.
 *
 * ⚠️ These are server-safe on purpose: no hooks, no "use client". A record page is
 * a server component that loads its data in one pass, and a kit that forced it
 * across the client boundary would ship every row to the browser twice.
 * `RecordSections` (the mobile tabs) is the one client part, in its own file.
 */

// ── Page shell ──────────────────────────────────────────────────────────────

export function RecordPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-4 sm:gap-6", className)}>{children}</div>;
}

/** Back to the list the record lives in. On a phone the top bar has its own back arrow, so this is desktop-only. */
export function RecordBackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-mb-2 hidden w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground md:flex"
    >
      <ChevronLeftIcon className="size-4" aria-hidden />
      {children}
    </Link>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

/**
 * What the record is, the state it is in, and what can be done to it.
 *
 * ⚠️ A wrapping row, not `flex-col sm:flex-row`: buttons that will not shrink
 * beside a title that will squeeze it to one word per line on a tablet; wrapping
 * sends the buttons to their own line instead.
 */
export function RecordHero({
  badges,
  title,
  avatar,
  meta,
  actions,
  children,
}: {
  /** Status first, then whatever qualifies it (stage, priority, score). */
  badges?: ReactNode;
  title: ReactNode;
  /** Initials or an icon, for records that are people or organisations. */
  avatar?: ReactNode;
  /** Who and where: `MetaItem`s, each a link to the related record where there is one. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Below the title block: the metric strip, a stage path, an outcome banner. */
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 sm:space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          {/*
            A grid rather than avatar-beside-column: on a phone the meta line runs
            the full width under the avatar instead of being squeezed beside it,
            where every item took a line of its own and the hero filled the screen.
            From sm up the meta sits under the title, as on a desktop.
          */}
          <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:min-w-64 sm:items-start sm:gap-x-4">
            {avatar && <div className="sm:row-span-2">{avatar}</div>}
            <div className={cn("min-w-0", !avatar && "col-span-2")}>
              {badges && <div className="mb-1 flex flex-wrap items-center gap-1.5 sm:mb-1.5 sm:gap-2">{badges}</div>}
              <h1 className="line-clamp-3 break-words font-bold text-lg leading-tight sm:line-clamp-none sm:text-2xl">
                {title}
              </h1>
            </div>
            {meta && (
              <div
                className={cn(
                  "col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground sm:gap-x-4 sm:text-sm",
                  avatar && "sm:col-span-1 sm:col-start-2",
                )}
              >
                {meta}
              </div>
            )}
          </div>
          {actions && (
            /*
              ⚠️ On a phone the actions are one row of equal tiles, icon over
              label — the quick-action row of a phone's own contact card. Two rows
              of full-width buttons spent a fifth of the screen before anything
              about the record. `auto-cols-fr` gives each whatever the row holds,
              so three actions or four still fit one line with no sideways scroll.
            */
            <div className="grid w-full grid-flow-col auto-cols-fr gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center max-sm:[&>*]:h-auto max-sm:[&>*]:min-h-14 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-col max-sm:[&>*]:gap-1 max-sm:[&>*]:whitespace-normal! max-sm:[&>*]:px-1 max-sm:[&>*]:py-1.5 max-sm:[&>*]:text-center max-sm:[&>*]:text-xs max-sm:[&>*]:leading-tight max-sm:[&_svg]:size-5!">
              {actions}
            </div>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function RecordAvatar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-bold text-base text-primary sm:size-14 sm:text-xl",
        className,
      )}
      aria-hidden
    >
      {children}
    </div>
  );
}

/** One fact in the line under the title — an icon and a name, a link when there is somewhere to go. */
export function MetaItem({ icon, href, children }: { icon?: ReactNode; href?: string | null; children: ReactNode }) {
  const className = "flex min-w-0 items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0";
  const body = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return href ? (
    <Link href={href} className={cn(className, "hover:text-foreground hover:underline")}>
      {body}
    </Link>
  ) : (
    <span className={className}>{body}</span>
  );
}

export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "",
};

/** The same five colours for every status on every record, so "green" means one thing. */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 [&_svg]:size-3", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

/** A coloured dot, for stages and anything else a workspace colours itself. */
export function ColourDot({ colour }: { colour: string | null | undefined }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: colour ?? "var(--muted-foreground)" }}
      aria-hidden
    />
  );
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * The two to four figures that decide what happens next. Two per row on a phone,
 * all on one row from sm; more than four is a report, not a header.
 */
export function MetricStrip({ children }: { children: ReactNode }) {
  return (
    // ⚠️ An odd last figure spans both columns on a phone: the strip's hairlines
    // are its background showing through a 1px gap, so an empty fourth cell was a
    // grey block.
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border max-sm:[&>:last-child:nth-child(odd)]:col-span-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
      {children}
    </dl>
  );
}

export function Metric({
  label,
  children,
  hint,
  tone,
}: {
  label: ReactNode;
  children: ReactNode;
  /** A line under the figure: "in 12 days", "3 overdue". */
  hint?: ReactNode;
  tone?: "danger" | "success";
}) {
  return (
    <div className="min-w-0 bg-card px-3 py-2 sm:px-4 sm:py-3">
      <dt className="line-clamp-2 break-words text-[11px] text-muted-foreground leading-tight sm:text-xs">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 min-w-0 truncate font-semibold text-base tabular-nums sm:mt-1 sm:text-xl",
          // A figure that is not there yet reads as a quiet dash, not as a bold one
          // competing with the figures that are.
          (children === "—" || children === null || children === undefined) && "font-normal text-muted-foreground",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {children}
      </dd>
      {hint && (
        <dd
          className={cn(
            "line-clamp-2 break-words text-[11px] leading-tight sm:text-xs",
            tone === "danger" ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {hint}
        </dd>
      )}
    </div>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

export function FieldList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("space-y-3 text-sm", className)}>{children}</dl>;
}

/**
 * Label and value on one line, the label a fixed column so the values align.
 * Renders nothing for an empty value unless `always` is set: a card of "—" rows
 * is a card nobody reads.
 */
export function Field({ label, children, always }: { label: ReactNode; children: ReactNode; always?: boolean }) {
  const empty = children === null || children === undefined || children === "" || children === false;
  if (empty && !always) return null;
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-words">{empty ? <span className="text-muted-foreground">—</span> : children}</dd>
    </div>
  );
}

/** A small heading inside a card, for a card that holds two short lists. */
export function SubHeading({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs [&_svg]:size-3.5">
      {icon}
      {children}
    </h3>
  );
}

/** What an empty section says: dashed, quiet, and — where it can — what to do about it. */
export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground text-sm">{children}</p>
  );
}

/** A related record in a list: name and date on the left, figure and status on the right, the whole row a link. */
export function RelatedRow({
  href,
  title,
  sub,
  aside,
}: {
  href: string;
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between gap-3 rounded-md border p-2.5 transition-colors hover:bg-accent"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">{title}</p>
        {sub && <p className="truncate text-muted-foreground text-xs">{sub}</p>}
      </div>
      {aside && <div className="flex shrink-0 flex-col items-end gap-1 text-sm">{aside}</div>}
    </Link>
  );
}

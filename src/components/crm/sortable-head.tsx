"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A column header that sorts the list (§4.5): the server already ordered by `sort` and
 * `dir`, and no header let anybody ask. A first click sorts ascending, a second descending;
 * the page goes back to the first, since page 7 of a new order is nobody's position.
 */
export function SortableHead({
  field,
  children,
  className,
}: {
  field: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get("sort") === field;
  const dir = active && params.get("dir") === "asc" ? "asc" : "desc";
  const next = new URLSearchParams(params.toString());
  next.set("sort", field);
  next.set("dir", active && dir === "asc" ? "desc" : "asc");
  next.delete("page");
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={`${pathname}?${next.toString()}`} className="inline-flex items-center gap-1 hover:text-foreground">
        {children}
        <Icon className={cn("size-3", active ? "text-foreground" : "text-muted-foreground/50")} aria-hidden />
      </Link>
    </TableHead>
  );
}

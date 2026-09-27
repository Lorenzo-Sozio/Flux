"use client";

import Link from "next/link";

import { Check, ChevronDown, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Whose appointments, as a menu — the phone's version of the segmented control.
 *
 * Three segments were a whole row above the calendar on a phone, for a choice
 * made once a week. Here it is a small button beside the subscribe icon, and the
 * options are the same links the segments are.
 */
export function CalendarFilterMenu({
  label,
  options,
}: {
  label: string;
  options: { value: string; label: string; href: string; active: boolean }[];
}) {
  const current = options.find((o) => o.active) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 px-2.5" aria-label={`${label}: ${current.label}`}>
          <Users className="size-4" aria-hidden />
          <span className="max-w-24 truncate">{current.label}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-muted-foreground text-xs">{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} asChild>
            <Link
              href={o.href}
              aria-current={o.active ? "true" : undefined}
              className="flex min-h-10 items-center gap-2"
            >
              <Check className={o.active ? "size-4" : "size-4 opacity-0"} aria-hidden />
              {o.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

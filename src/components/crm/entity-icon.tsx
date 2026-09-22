"use client";

import {
  Building2,
  CalendarDays,
  CheckSquare,
  FileText,
  Handshake,
  LifeBuoy,
  type LucideIcon,
  Mail,
  Megaphone,
  Package,
  Paperclip,
  Receipt,
  ScrollText,
  ShoppingCart,
  Tags,
  Target,
  Undo2,
  User,
  Workflow,
} from "lucide-react";

import { type EntityGroup, entityDef } from "@/lib/entities";
import { cn } from "@/lib/utils";

/** The icon names src/lib/entities.ts uses, as components. */
const ICONS: Record<string, LucideIcon> = {
  Building2,
  CalendarDays,
  CheckSquare,
  FileText,
  Handshake,
  LifeBuoy,
  Mail,
  Megaphone,
  Package,
  Paperclip,
  Receipt,
  ScrollText,
  ShoppingCart,
  Tags,
  Target,
  Undo2,
  User,
  Workflow,
};

/** One tint per section, so a mixed list reads by kind at a glance. */
export const GROUP_TINT: Record<EntityGroup, string> = {
  crm: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  sales: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  documents: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  support: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  work: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  marketing: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

export function entityIcon(type: string): LucideIcon {
  return ICONS[entityDef(type)?.icon ?? ""] ?? FileText;
}

/** The icon of a kind of record, on its section's tint. */
export function EntityBadgeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = entityIcon(type);
  const group = entityDef(type)?.group ?? "crm";
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", GROUP_TINT[group], className)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

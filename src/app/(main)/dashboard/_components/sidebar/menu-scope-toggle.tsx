"use client";

import { ListCollapse, ListPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Show all sections" / "Only the essentials" — for a person whose menu leaves out what
 * they rarely need (§4.1). Absent for whoever already sees everything.
 */
export function MenuScopeToggle({
  full,
  onChange,
  hiddenCount,
  className,
}: {
  full: boolean;
  onChange: (full: boolean) => void;
  hiddenCount: number;
  className?: string;
}) {
  const t = useTranslations("nav.scope");
  if (hiddenCount === 0) return null;
  const Icon = full ? ListCollapse : ListPlus;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-8 w-full justify-start gap-2 text-muted-foreground text-xs", className)}
      onClick={() => onChange(!full)}
      aria-pressed={full}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{full ? t("essentials") : t("showAll", { count: hiddenCount })}</span>
    </Button>
  );
}

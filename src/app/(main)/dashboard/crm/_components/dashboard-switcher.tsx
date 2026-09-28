"use client";

import Link from "next/link";

import { Check, ChevronDown, LayoutDashboard, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HomeDashboard } from "@/lib/home-dashboards";

/**
 * Which dashboard the home shows, and a way to another one for this visit.
 *
 * A link carries the choice (`?dashboard=`), so the server renders only that dashboard's
 * figures. The one that opens by default is chosen in the Profile, not here: a menu that
 * silently changed the default every time somebody glanced at another view would open
 * tomorrow on whatever they happened to look at last.
 */
export function DashboardSwitcher({ current, available }: { current: HomeDashboard; available: HomeDashboard[] }) {
  const t = useTranslations("crm.dashboards");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-10 max-w-full gap-2 sm:h-9"
          aria-label={t("switchLabel", { name: t(`${current}.name`) })}
        >
          <LayoutDashboard className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{t(`${current}.name`)}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="text-muted-foreground text-xs">{t("label")}</DropdownMenuLabel>
        {available.map((d) => (
          <DropdownMenuItem key={d} asChild className="items-start py-2">
            <Link href={`/dashboard/crm?dashboard=${d}`} aria-current={d === current ? "page" : undefined}>
              <Check className={d === current ? "mt-0.5 size-4 text-primary" : "mt-0.5 size-4 opacity-0"} aria-hidden />
              <span className="min-w-0">
                <span className="block font-medium">{t(`${d}.name`)}</span>
                <span className="block text-muted-foreground text-xs">{t(`${d}.desc`)}</span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/profile#home-dashboard" className="text-muted-foreground text-xs">
            <Settings2 className="size-4" aria-hidden />
            {t("setDefault")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

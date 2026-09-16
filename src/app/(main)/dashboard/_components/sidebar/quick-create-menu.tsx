"use client";

import Link from "next/link";

import { PlusCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { entityIcon, GROUP_TINT } from "@/components/crm/entity-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { ENTITIES, ENTITY_GROUPS, type EntityType } from "@/lib/entities";
import { cn } from "@/lib/utils";

/**
 * Quick create: everything this person may create, by section.
 *
 * ⚠️ It was nine hand-written links — five of which pointed at `?new=true` on
 * pages that did not read it — and no invoice, contract or appointment. The
 * entries come from src/lib/entities.ts now, filtered on the server by role and
 * plan (`creatable`), and laid out as a panel of sections so fifteen entries are
 * still something the eye can take in at once.
 */
export function QuickCreateMenu({ creatable }: { creatable: readonly EntityType[] }) {
  const te = useTranslations("entities");
  const { isMobile } = useSidebar();
  const allowed = new Set(creatable);
  const sections = ENTITY_GROUPS.map((group) => ({
    group,
    entries: ENTITIES.filter((e) => e.group === group && e.create && allowed.has(e.type)),
  })).filter((s) => s.entries.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          tooltip={te("quickCreate.title")}
          className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
        >
          <PlusCircleIcon />
          <span>{te("quickCreate.title")}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={isMobile ? "bottom" : "right"}
        align="start"
        className="max-h-[min(34rem,80dvh)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto p-2"
      >
        <DropdownMenuLabel className="px-2 pb-2 font-normal text-muted-foreground text-xs">
          {sections.length > 0 ? te("quickCreate.hint") : te("quickCreate.none")}
        </DropdownMenuLabel>
        <div className="grid grid-cols-1 gap-x-2 gap-y-3 sm:grid-cols-2">
          {sections.map(({ group, entries }) => (
            <div key={group} className="min-w-0">
              <p className="px-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                {te(`groups.${group}` as never)}
              </p>
              {entries.map((e) => {
                const Icon = entityIcon(e.type);
                return (
                  <DropdownMenuItem key={e.type} asChild>
                    <Link prefetch={false} href={e.create?.href ?? e.list} className="flex items-center gap-2">
                      <span className={cn("flex h-6 w-6 items-center justify-center rounded", GROUP_TINT[group])}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">{te(`types.${e.type}.new` as never)}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

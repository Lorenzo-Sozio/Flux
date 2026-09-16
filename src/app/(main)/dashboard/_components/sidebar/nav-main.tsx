"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChevronRight, Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { EntityType } from "@/lib/entities";
import type { NavGroup, NavMainItem, NavSubItem } from "@/navigation/sidebar/sidebar-items";

import { QuickCreateMenu } from "./quick-create-menu";

interface NavMainProps {
  readonly items: readonly NavGroup[];
  /**
   * Whether to draw the quick-create button above the groups.
   *
   * ⚠️ False for the second call. The sidebar renders this component twice below
   * md — once for the destinations and once for administration, which is a
   * dropdown under the avatar at wider widths — and the button belongs to the
   * panel, not to a group of it. Rendering it twice put a second Crea Rapido in
   * the middle of the menu.
   */
  readonly showQuickCreate?: boolean;
  /** What this person may create in this plan, decided by the layout. */
  readonly creatable?: readonly EntityType[];
}

const IsComingSoon = () => {
  const t = useTranslations("nav");
  return <span className="ml-auto rounded-md bg-gray-200 px-2 py-1 text-xs dark:text-gray-800">{t("soon")}</span>;
};

/**
 * A module the plan does not include.
 *
 * Shown and locked rather than hidden: clicking used to bounce through billing
 * and back to the dashboard with nothing said, which is both confusing and the
 * biggest missed upgrade prompt in the product (audit rilievo D-08). The link
 * goes straight to the plan comparison, carrying which module was wanted.
 */
const LockedBadge = () => <Lock className="ml-auto size-3.5 shrink-0 text-muted-foreground" />;

function lockHref(module: string | undefined) {
  return `/dashboard/settings/billing${module ? `?upgrade=${encodeURIComponent(module)}` : ""}`;
}

const NavItemExpanded = ({
  item,
  isActive,
  isSubmenuOpen,
  t,
}: {
  item: NavMainItem;
  isActive: (url: string, subItems?: NavSubItem[]) => boolean;
  isSubmenuOpen: (subItems?: NavSubItem[]) => boolean;
  t: ReturnType<typeof useTranslations<"nav">>;
}) => {
  const title = t(`items.${item.titleKey}` as any);
  const locked = Boolean(item.locked);
  return (
    <Collapsible key={item.titleKey} asChild defaultOpen={isSubmenuOpen(item.subItems)} className="group/collapsible">
      <SidebarMenuItem>
        {item.subItems ? (
          <>
            <SidebarMenuButton
              asChild
              aria-disabled={item.comingSoon}
              isActive={isActive(item.url, item.subItems)}
              tooltip={title}
            >
              <Link prefetch={false} href={item.url}>
                {item.icon && <item.icon />}
                <span>{title}</span>
                {item.comingSoon && <IsComingSoon />}
              </Link>
            </SidebarMenuButton>
            <CollapsibleTrigger asChild>
              <SidebarMenuAction className="data-[state=open]:rotate-90">
                <ChevronRight />
              </SidebarMenuAction>
            </CollapsibleTrigger>
          </>
        ) : (
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              asChild
              aria-disabled={item.comingSoon}
              isActive={isActive(item.url)}
              tooltip={locked ? t("notInPlan", { title }) : title}
            >
              <Link
                prefetch={false}
                href={locked ? lockHref(item.lockedModule) : item.url}
                target={item.newTab && !locked ? "_blank" : undefined}
                className={locked ? "opacity-60" : undefined}
              >
                {item.icon && <item.icon />}
                <span>{title}</span>
                {item.comingSoon && <IsComingSoon />}
                {locked && <LockedBadge />}
              </Link>
            </SidebarMenuButton>
          </CollapsibleTrigger>
        )}
        {item.subItems && (
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.subItems.map((subItem) => (
                <SidebarMenuSubItem key={subItem.titleKey}>
                  <SidebarMenuSubButton aria-disabled={subItem.comingSoon} isActive={isActive(subItem.url)} asChild>
                    <Link
                      prefetch={false}
                      href={subItem.locked ? lockHref(subItem.lockedModule) : subItem.url}
                      target={subItem.newTab && !subItem.locked ? "_blank" : undefined}
                      className={subItem.locked ? "opacity-60" : undefined}
                    >
                      {subItem.icon && <subItem.icon />}
                      <span>{t(`items.${subItem.titleKey}` as any)}</span>
                      {subItem.comingSoon && <IsComingSoon />}
                      {subItem.locked && <LockedBadge />}
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        )}
      </SidebarMenuItem>
    </Collapsible>
  );
};

const NavItemCollapsed = ({
  item,
  isActive,
  t,
}: {
  item: NavMainItem;
  isActive: (url: string, subItems?: NavSubItem[]) => boolean;
  t: ReturnType<typeof useTranslations<"nav">>;
}) => {
  const title = t(`items.${item.titleKey}` as any);
  return (
    <SidebarMenuItem key={item.titleKey}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton disabled={item.comingSoon} tooltip={title} isActive={isActive(item.url, item.subItems)}>
            {item.icon && <item.icon />}
            <span>{title}</span>
            <ChevronRight />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-50 space-y-1" side="right" align="start">
          {item.subItems?.map((subItem) => (
            <DropdownMenuItem key={subItem.titleKey} asChild>
              <SidebarMenuSubButton
                key={subItem.titleKey}
                asChild
                className="focus-visible:ring-0"
                aria-disabled={subItem.comingSoon}
                isActive={isActive(subItem.url)}
              >
                <Link prefetch={false} href={subItem.url} target={subItem.newTab ? "_blank" : undefined}>
                  {subItem.icon && <subItem.icon className="[&>svg]:text-sidebar-foreground" />}
                  <span>{t(`items.${subItem.titleKey}` as any)}</span>
                  {subItem.comingSoon && <IsComingSoon />}
                </Link>
              </SidebarMenuSubButton>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

export function NavMain({ items, showQuickCreate = true, creatable = [] }: NavMainProps) {
  const path = usePathname();
  const { state, isMobile } = useSidebar();
  const t = useTranslations("nav");

  const isItemActive = (url: string, subItems?: NavMainItem["subItems"]) => {
    if (subItems?.length) {
      return subItems.some((sub) => path.startsWith(sub.url));
    }
    return path === url;
  };

  const isSubmenuOpen = (subItems?: NavMainItem["subItems"]) => {
    return subItems?.some((sub) => path.startsWith(sub.url)) ?? false;
  };

  return (
    <>
      {showQuickCreate && (
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem className="flex items-center gap-2">
                <QuickCreateMenu creatable={creatable} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      {items.map((group) => (
        <SidebarGroup key={group.id}>
          {group.labelKey && <SidebarGroupLabel>{t(`groups.${group.labelKey}` as any)}</SidebarGroupLabel>}
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {group.items.map((item) => {
                if (state === "collapsed" && !isMobile) {
                  if (!item.subItems) {
                    return (
                      <SidebarMenuItem key={item.titleKey}>
                        <SidebarMenuButton
                          asChild
                          aria-disabled={item.comingSoon}
                          tooltip={t(`items.${item.titleKey}` as any)}
                          isActive={isItemActive(item.url)}
                        >
                          <Link prefetch={false} href={item.url} target={item.newTab ? "_blank" : undefined}>
                            {item.icon && <item.icon />}
                            <span>{t(`items.${item.titleKey}` as any)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }
                  return <NavItemCollapsed key={item.titleKey} item={item} isActive={isItemActive} t={t} />;
                }
                return (
                  <NavItemExpanded
                    key={item.titleKey}
                    item={item}
                    isActive={isItemActive}
                    isSubmenuOpen={isSubmenuOpen}
                    t={t}
                  />
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

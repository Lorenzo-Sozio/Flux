"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Building2,
  CheckSquare,
  ChevronRight,
  Contact,
  FileText,
  Headphones,
  Kanban,
  MessageSquare,
  PlusCircleIcon,
  ShoppingCart,
  Users,
} from "lucide-react";

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
import type { NavGroup, NavMainItem } from "@/navigation/sidebar/sidebar-items";

interface NavMainProps {
  readonly items: readonly NavGroup[];
}

const IsComingSoon = () => (
  <span className="ml-auto rounded-md bg-gray-200 px-2 py-1 text-xs dark:text-gray-800">Soon</span>
);

const NavItemExpanded = ({
  item,
  isActive,
  isSubmenuOpen,
  t,
}: {
  item: NavMainItem;
  isActive: (url: string, subItems?: NavMainItem["subItems"]) => boolean;
  isSubmenuOpen: (subItems?: NavMainItem["subItems"]) => boolean;
  t: ReturnType<typeof useTranslations<"nav">>;
}) => {
  const title = t(`items.${item.titleKey}` as any);
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
              tooltip={title}
            >
              <Link prefetch={false} href={item.url} target={item.newTab ? "_blank" : undefined}>
                {item.icon && <item.icon />}
                <span>{title}</span>
                {item.comingSoon && <IsComingSoon />}
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
                    <Link prefetch={false} href={subItem.url} target={subItem.newTab ? "_blank" : undefined}>
                      {subItem.icon && <subItem.icon />}
                      <span>{t(`items.${subItem.titleKey}` as any)}</span>
                      {subItem.comingSoon && <IsComingSoon />}
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
  isActive: (url: string, subItems?: NavMainItem["subItems"]) => boolean;
  t: ReturnType<typeof useTranslations<"nav">>;
}) => {
  const title = t(`items.${item.titleKey}` as any);
  return (
    <SidebarMenuItem key={item.titleKey}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            disabled={item.comingSoon}
            tooltip={title}
            isActive={isActive(item.url, item.subItems)}
          >
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

export function NavMain({ items }: NavMainProps) {
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
      <SidebarGroup>
        <SidebarGroupContent className="flex flex-col gap-2">
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    tooltip={t("quickCreate.title")}
                    className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  >
                    <PlusCircleIcon />
                    <span>{t("quickCreate.title")}</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-52" side="right" align="start">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{t("quickCreate.crm")}</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/leads?new=true" className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5" /> {t("quickCreate.newLead")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/contacts?new=true" className="flex items-center gap-2">
                      <Contact className="h-3.5 w-3.5" /> {t("quickCreate.newContact")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/companies?new=true" className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" /> {t("quickCreate.newCompany")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/pipeline?new=true" className="flex items-center gap-2">
                      <Kanban className="h-3.5 w-3.5" /> {t("quickCreate.newDeal")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{t("quickCreate.sales")}</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/quotes/new" className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" /> {t("quickCreate.newQuote")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/orders?new=true" className="flex items-center gap-2">
                      <ShoppingCart className="h-3.5 w-3.5" /> {t("quickCreate.newOrder")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">{t("quickCreate.work")}</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/tasks?new=true" className="flex items-center gap-2">
                      <CheckSquare className="h-3.5 w-3.5" /> {t("quickCreate.newTask")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/support/tickets?new=true" className="flex items-center gap-2">
                      <Headphones className="h-3.5 w-3.5" /> {t("quickCreate.newTicket")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link prefetch={false} href="/dashboard/marketing/campaigns?new=true" className="flex items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5" /> {t("quickCreate.newCampaign")}
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {items.map((group) => (
        <SidebarGroup key={group.id}>
          {group.labelKey && (
            <SidebarGroupLabel>{t(`groups.${group.labelKey}` as any)}</SidebarGroupLabel>
          )}
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
                  <NavItemExpanded key={item.titleKey} item={item} isActive={isItemActive} isSubmenuOpen={isSubmenuOpen} t={t} />
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

"use client";

import Link from "next/link";

import { EllipsisVertical, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

import { logoutAction } from "@/actions/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { getInitials } from "@/lib/utils";
import type { NavGroup } from "@/navigation/sidebar/sidebar-items";

export function NavUser({
  user,
  groups = [],
}: {
  readonly user: {
    readonly name?: string | null;
    readonly email?: string | null;
    readonly image?: string | null;
  };
  /**
   * Administration, already filtered against role and plan by the same pass that
   * filters the sidebar. Empty for anyone who may open none of it, and the menu
   * then holds what it always held.
   */
  readonly groups?: readonly NavGroup[];
}) {
  const { isMobile } = useSidebar();
  const t = useTranslations("nav.user");
  const tNav = useTranslations("nav");
  const userName = user?.name || t("unknownUser");
  const userEmail = user?.email || "";
  const userImage = user?.image || undefined;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarImage src={userImage} alt={userName} />
                <AvatarFallback className="rounded-lg">{getInitials(userName)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{userName}</span>
                <span className="truncate text-muted-foreground text-xs">{userEmail}</span>
              </div>
              <EllipsisVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={userImage} alt={userName} />
                  <AvatarFallback className="rounded-lg">{getInitials(userName)}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName}</span>
                  <span className="truncate text-muted-foreground text-xs">{userEmail}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            {/* Hidden below md, where the sidebar panel lists these as a section
                of its own. Two renderings of one filtered list, never both. */}
            {groups.map((group) => (
              <DropdownMenuGroup key={group.id} className="hidden md:block">
                <DropdownMenuSeparator />
                {group.items.map((item) =>
                  item.subItems && item.subItems.length > 0 ? (
                    <DropdownMenuSub key={item.titleKey}>
                      <DropdownMenuSubTrigger className="gap-2">
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span>{tNav(`items.${item.titleKey}` as never)}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-48">
                        <DropdownMenuItem asChild>
                          <Link prefetch={false} href={item.url} className="flex items-center gap-2">
                            {item.icon && <item.icon className="h-4 w-4" />}
                            <span>{tNav(`items.${item.titleKey}` as never)}</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {item.subItems.map((sub) => (
                          <DropdownMenuItem key={sub.titleKey} asChild>
                            <Link prefetch={false} href={sub.url} className="flex items-center gap-2">
                              {sub.icon && <sub.icon className="h-4 w-4" />}
                              <span>{tNav(`items.${sub.titleKey}` as never)}</span>
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : (
                    <DropdownMenuItem key={item.titleKey} asChild>
                      <Link prefetch={false} href={item.url} className="flex items-center gap-2">
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span>{tNav(`items.${item.titleKey}` as never)}</span>
                      </Link>
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuGroup>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action={logoutAction} className="w-full">
                <button type="submit" className="flex w-full items-center gap-2">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("logout")}</span>
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

"use client";

import { useMemo } from "react";

import Link from "next/link";

import { Command } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { CurrencySwitcher } from "@/components/ui/currency-switcher";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { applyNavAccess, type NavAccess } from "@/navigation/sidebar/filter-nav";
import { accountPlacement, sidebarItems, sidebarPlacement } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";

export function AppSidebar({
  user,
  navAccess,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user: any; navAccess: NavAccess }) {
  // The menu — icons included — is imported here, on the client, and never
  // travels. Only the server's verdict about it does.
  const navGroups = useMemo(() => applyNavAccess(sidebarItems, navAccess), [navAccess]);
  // Administration is filtered by the same pass as everything else and only
  // then split out: it is the account menu, not a destination.
  const mainGroups = useMemo(() => sidebarPlacement(navGroups), [navGroups]);
  const accountGroups = useMemo(() => accountPlacement(navGroups), [navGroups]);

  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.sidebarVariant,
      sidebarCollapsible: s.sidebarCollapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link prefetch={false} href="/dashboard/crm">
                <Command />
                <span className="font-semibold text-base">{APP_CONFIG.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* Filtered by the layout against the viewer's role and plan; the full
            list used to be rendered to everybody (audit rilievi D-08, U-02). */}
        <NavMain items={mainGroups} />

        {/*
          ⚠️ Administration is the account menu from md up — a dropdown under the
          avatar, which is where a desktop puts settings. On a phone that same
          dropdown is at the bottom of a slide-out panel, behind a row that looks
          like a profile, and opening it is a nested menu inside a sheet: four
          taps to reach Settings, and nothing on the way says Settings is there.

          Below md it is an ordinary section of the panel instead, with its own
          heading. Same filtered groups, rendered twice at different widths —
          never both at once, and never a second permission rule.
        */}
        <div className="md:hidden">
          <NavMain items={accountGroups} showQuickCreate={false} />
        </div>
      </SidebarContent>
      <SidebarFooter>
        {/* ⚠️ Language and currency come off the header below md — nine controls
            do not fit a 375px bar — so they have to be somewhere, and this panel
            is the somewhere: two taps from the bottom bar, and the only other
            place a person looks for a setting. Hidden from md up, where the
            header still carries them. */}
        <div className="flex items-center gap-1 px-1 pb-1 md:hidden">
          <LocaleSwitcher />
          <CurrencySwitcher />
        </div>
        <NavUser user={user} groups={accountGroups} />
      </SidebarFooter>
    </Sidebar>
  );
}

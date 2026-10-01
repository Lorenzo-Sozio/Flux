"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LayoutGrid, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { LinkPending } from "@/components/intent-link";
import type { EntityType } from "@/lib/entities";
import { cn } from "@/lib/utils";
import { applyNavAccess, type NavAccess } from "@/navigation/sidebar/filter-nav";
import { type NavMainItem, pickMobileTabs, sidebarItems } from "@/navigation/sidebar/sidebar-items";

import { MenuScopeToggle } from "./menu-scope-toggle";
import { MobileCreateSheet } from "./mobile-create-sheet";
import { MobileMenuHub } from "./mobile-menu-hub";
import { useMobileTabPreference } from "./mobile-nav-prefs";
import { useFullMenu } from "./use-full-menu";

/**
 * The bottom bar, on phones only: `[shortcut] [shortcut] (Create) [shortcut] [Menu]`.
 *
 * A hamburger is two taps and a hidden mental model for every move between
 * screens, and on a phone held one-handed the top-left corner is the hardest
 * place on the glass to reach. So everything navigation needs is down here:
 *
 * - three shortcuts to the places someone moves between all day — chosen by the
 *   person from the Menu, defaulting to Dashboard, Contacts and Calendar;
 * - Create in the middle, raised, where either thumb reaches it: the most
 *   frequent thing done with a CRM on the move is writing something down;
 * - the Menu, which opens the navigation hub *from the bottom*, the edge the
 *   thumb is already on.
 *
 * ⚠️ The shortcuts are chosen from the **already filtered** menu, so a viewer
 * cannot get a tab to a page they would be bounced from, and a workspace whose
 * plan excludes support does not spend a slot on tickets. A person's own choice
 * is only an order passed to the same function — there is no second permission
 * rule here.
 */

function isActive(pathname: string, url: string): boolean {
  if (pathname === url) return true;
  // A ticket's own page keeps the Tickets tab lit; /dashboard/crm must not claim
  // every path, which a bare `startsWith` on a short prefix would do.
  return pathname.startsWith(`${url}/`);
}

function Tab({ tab, active, label }: { tab: NavMainItem; active: boolean; label: string }) {
  return (
    <li className="flex-1">
      <Link
        href={tab.url}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full flex-col items-center justify-center gap-1 px-1 transition-colors",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {tab.icon && <tab.icon className={cn("size-5 shrink-0", active && "stroke-[2.25]")} aria-hidden />}
        <span className="max-w-full truncate font-medium text-[10px] leading-none">{label}</span>
        {/* Answered at the tap, while the page is on its way. */}
        <LinkPending className="-mt-0.5" />
      </Link>
    </li>
  );
}

export function MobileTabBar({
  navAccess,
  creatable,
  user,
}: {
  readonly navAccess: NavAccess;
  readonly creatable: readonly EntityType[];
  readonly user: { name?: string | null; email?: string | null; image?: string | null };
}) {
  const t = useTranslations("nav");
  const tm = useTranslations("nav.mobile");
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { pinned, preference, setPinned } = useMobileTabPreference();

  const groups = useMemo(() => applyNavAccess(sidebarItems, navAccess), [navAccess]);
  // A shortcut someone pinned stays, whatever the menu lists; the hub lists what the
  // sidebar does (§4.1).
  const tabs = useMemo(() => pickMobileTabs(groups, { preference }), [groups, preference]);
  const { full, setFull } = useFullMenu();
  const hubGroups = useMemo(() => applyNavAccess(sidebarItems, navAccess, { focused: !full }), [navAccess, full]);

  // When the current page is not one of the shortcuts, the Menu is lit: it is
  // where you went to get here, and where you go to leave.
  const activeUrl = tabs.find((tab) => isActive(pathname, tab.url))?.url;
  const [left, right] = [tabs.slice(0, 2), tabs.slice(2)];
  const label = (tab: NavMainItem) => t(`items.${tab.titleKey}` as never);

  return (
    <>
      <nav
        aria-label={tm("barLabel")}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 md:hidden",
          "border-t bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80",
        )}
        // The home indicator on a modern phone sits inside the bar's rectangle;
        // without this the last row of labels is under it.
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <ul className="flex h-[var(--mobile-nav-height)] items-stretch">
          {left.map((tab) => (
            <Tab key={tab.url} tab={tab} active={tab.url === activeUrl} label={label(tab)} />
          ))}

          <li className="flex flex-1 items-start justify-center">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={createOpen}
              className="group flex flex-col items-center gap-1 focus-visible:outline-none"
            >
              {/* Raised above the bar: the one control on it that is an action,
                  not a place, and it should not be mistaken for one. */}
              <span className="-mt-4 flex size-13 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform group-focus-visible:ring-ring group-active:scale-95">
                <Plus className="size-6" aria-hidden />
              </span>
              <span className="font-medium text-[10px] text-foreground leading-none">{tm("create")}</span>
            </button>
          </li>

          {right.map((tab) => (
            <Tab key={tab.url} tab={tab} active={tab.url === activeUrl} label={label(tab)} />
          ))}

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-1 px-1 transition-colors",
                !activeUrl ? "text-primary" : "text-muted-foreground",
              )}
            >
              <LayoutGrid className={cn("size-5 shrink-0", !activeUrl && "stroke-[2.25]")} aria-hidden />
              <span className="font-medium text-[10px] leading-none">{tm("menu")}</span>
            </button>
          </li>
        </ul>
      </nav>

      <MobileCreateSheet open={createOpen} onOpenChange={setCreateOpen} creatable={creatable} />
      <MobileMenuHub
        open={menuOpen}
        onOpenChange={setMenuOpen}
        groups={hubGroups}
        scopeToggle={<MenuScopeToggle full={full} onChange={setFull} hiddenCount={navAccess.secondary?.length ?? 0} />}
        user={user}
        pinned={pinned}
        onPin={setPinned}
        currentTabs={tabs}
      />
    </>
  );
}

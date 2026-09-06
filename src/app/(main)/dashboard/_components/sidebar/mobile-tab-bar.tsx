"use client";

import { useMemo } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { applyNavAccess, type NavAccess } from "@/navigation/sidebar/filter-nav";
import { pickMobileTabs, sidebarItems } from "@/navigation/sidebar/sidebar-items";

/**
 * The bottom bar, on phones only.
 *
 * A hamburger is two taps and a hidden mental model for every single move
 * between screens, and on a phone held one-handed the top-left corner is the
 * hardest place on the glass to reach. The five destinations someone actually
 * moves between all day belong under the thumb.
 *
 * ⚠️ The menu is **not** one of them. It is the trigger in the header, on the
 * left, at the edge the panel comes out of. A menu button in the last slot of
 * this bar opened a panel from the opposite side of the screen and cost a fifth
 * of the navigation to do it.
 *
 * ⚠️ The entries are chosen from the **already filtered** menu, so a viewer
 * cannot get a tab to a page they would be bounced from, and a workspace whose
 * plan excludes support does not spend a quarter of its bar on tickets. There is
 * no second permission rule here — only a preference order over what survived
 * the first one.
 *
 * Locked entries are skipped rather than shown. In the sidebar a locked module
 * is the upgrade prompt and worth its line; in five slots it is a fifth of the
 * navigation spent on something that does not open.
 */

function isActive(pathname: string, url: string): boolean {
  if (pathname === url) return true;
  // A ticket's own page keeps the Tickets tab lit; /dashboard/crm must not claim
  // every path, which a bare `startsWith` on a short prefix would do.
  return pathname.startsWith(`${url}/`);
}

export function MobileTabBar({ navAccess }: { readonly navAccess: NavAccess }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  // Five destinations. The menu is the trigger in the header, on the left,
  // where the panel it opens comes from — it is not one of these.
  const tabs = useMemo(() => pickMobileTabs(applyNavAccess(sidebarItems, navAccess)), [navAccess]);

  // When the current page is not one of the five, none of them is lit — rather
  // than lighting whichever happens to be a prefix of the path.
  const activeUrl = tabs.find((tab) => isActive(pathname, tab.url))?.url;

  return (
    <nav
      aria-label={t("groups.work")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-t bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/80",
      )}
      // The home indicator on a modern phone sits inside the bar's rectangle;
      // without this the last row of labels is under it.
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <ul className="flex h-[var(--mobile-nav-height)] items-stretch">
        {tabs.map((tab) => {
          const active = tab.url === activeUrl;
          return (
            <li key={tab.url} className="flex-1">
              <Link
                href={tab.url}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 px-1 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {tab.icon && <tab.icon className={cn("size-5 shrink-0", active && "stroke-[2.25]")} aria-hidden />}
                <span className="max-w-full truncate font-medium text-[10px] leading-none">
                  {t(`items.${tab.titleKey}` as never)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

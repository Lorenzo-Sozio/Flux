import type { ReactNode } from "react";

import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { AppSidebar } from "@/app/(main)/dashboard/_components/sidebar/app-sidebar";
import { auth } from "@/auth";
import { getNotificationsAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SIDEBAR_COLLAPSIBLE_VALUES, SIDEBAR_VARIANT_VALUES } from "@/lib/preferences/layout";
import { cn } from "@/lib/utils";
import { getPreference } from "@/server/server-actions";
import { platformDb } from "@/db";
import { tenantMembers, tenants, users } from "@/db/schema";
import { getCurrentSubdomain, getDb } from "@/lib/tenant-context";

//import { AccountSwitcher } from "./_components/sidebar/account-switcher";
import { LayoutControls } from "./_components/sidebar/layout-controls";
import { SearchDialog } from "./_components/sidebar/search-dialog";
import { ThemeSwitcher } from "./_components/sidebar/theme-switcher";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { CurrencySwitcher } from "@/components/ui/currency-switcher";
import { CurrencyProvider } from "@/contexts/currency-context";
import { RecentlyVisited } from "@/components/crm/recently-visited";
import { ChatWidget } from "@/components/chat/chat-widget";

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth();
  const user = session?.user || { name: "Ospite", email: "" };

  // ── Tenant subdomain: verify membership + sync user to tenant DB ──────────
  const subdomain = await getCurrentSubdomain();
  if (subdomain) {
    if (!session?.user?.id) redirect("/auth/v1/login");
  }
  if (subdomain && session?.user?.id) {
    const [tenant] = await platformDb
      .select()
      .from(tenants)
      .where(eq(tenants.subdomain, subdomain));

    if (!tenant) redirect("/not-found");

    const [member] = await platformDb
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenantId, tenant.id),
          eq(tenantMembers.userId, session.user.id),
        ),
      );

    if (!member) redirect("/unauthorized");

    // Upsert the user into the tenant DB so tenant-side FK constraints work.
    // This is a fast no-op on subsequent visits (onConflictDoUpdate is idempotent).
    const db = await getDb();
    await db
      .insert(users)
      .values({
        id: session.user.id,
        name: session.user.name ?? "",
        email: session.user.email ?? "",
        role: member.role,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: session.user.name ?? "", role: member.role },
      });
  }
  // ─────────────────────────────────────────────────────────────────────────

  const cookieStore = await cookies();
  const userNotifications = session?.user?.id
    ? await getNotificationsAction(session.user.id)
    : [];
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const [variant, collapsible] = await Promise.all([
    getPreference("sidebar_variant", SIDEBAR_VARIANT_VALUES, "inset"),
    getPreference("sidebar_collapsible", SIDEBAR_COLLAPSIBLE_VALUES, "icon"),
  ]);

  return (
    <CurrencyProvider>
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={user} variant={variant} collapsible={collapsible} />
      <SidebarInset
        className={cn(
          "overflow-hidden",
          "[html[data-content-layout=centered]_&]:mx-auto! [html[data-content-layout=centered]_&]:max-w-screen-2xl!",
          // Adds right margin for inset sidebar in centered layout up to 113rem.
          // On wider screens with collapsed sidebar, removes margin and sets margin auto for alignment.
          "max-[113rem]:peer-data-[variant=inset]:mr-2! min-[101rem]:peer-data-[variant=inset]:peer-data-[state=collapsed]:mr-auto!",
        )}
      >
        <header
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
            // Handle sticky navbar style with conditional classes so blur, background, z-index, and rounded corners remain consistent across all SidebarVariant layouts.
            "[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:bg-background/50 [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
          )}
        >
          <div className="flex w-full items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-1 lg:gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
              />
              <SearchDialog />
            </div>
            <div className="flex items-center gap-2">
              <RecentlyVisited />
              {session?.user?.id && (
                <NotificationCenter
                  notifications={userNotifications}
                  userId={session.user.id}
                />
              )}
              <CurrencySwitcher />
              <LocaleSwitcher />
              <LayoutControls />
              <ThemeSwitcher />
            </div>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">{children}</div>
      </SidebarInset>
      {session?.user?.id && <ChatWidget userId={session.user.id} />}
    </SidebarProvider>
    </CurrencyProvider>
  );
}

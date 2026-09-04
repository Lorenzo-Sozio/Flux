import type { ReactNode } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { and, eq, ne } from "drizzle-orm";

import { getNotificationsAction } from "@/actions/auth";
import { AppSidebar } from "@/app/(main)/dashboard/_components/sidebar/app-sidebar";
import { auth } from "@/auth";
import { ChatWidget } from "@/components/chat/chat-widget";
import { RecentlyVisited } from "@/components/crm/recently-visited";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { CurrencySwitcher } from "@/components/ui/currency-switcher";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { CurrencyProvider } from "@/contexts/currency-context";
import { platformDb } from "@/db";
import { tenantMembers, tenants, users } from "@/db/schema";
import { getTenantEntitlements } from "@/lib/auth-guard";
import { normalizeTenantRole } from "@/lib/permissions";
import { SIDEBAR_COLLAPSIBLE_VALUES, SIDEBAR_VARIANT_VALUES } from "@/lib/preferences/layout";
import { getDb } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";
import { computeNavAccess } from "@/navigation/sidebar/filter-nav";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";
import { getPreference } from "@/server/server-actions";

import { LayoutControls } from "./_components/sidebar/layout-controls";
import { SearchDialog } from "./_components/sidebar/search-dialog";
import { ThemeSwitcher } from "./_components/sidebar/theme-switcher";

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await auth();
  const user = session?.user || { name: "Ospite", email: "" };

  // ── Tenant membership verification ───────────────────────────────────────────
  // The middleware already validated that activeTenantId is in the JWT and
  // injected it as x-tenant-id. Here we additionally verify the user is still
  // a member of that tenant (belt-and-suspenders guard).
  const activeTenantId = session?.user?.activeTenantId;

  if (!session?.user?.id || !activeTenantId) {
    redirect("/select-tenant");
  }

  const [tenant] = await platformDb.select().from(tenants).where(eq(tenants.id, activeTenantId));

  if (!tenant) redirect("/select-tenant");

  const [member] = await platformDb
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, session.user.id)));

  if (!member) redirect("/select-tenant");

  // Upsert the user into the tenant DB so tenant-side FK constraints work.
  // Fast no-op on subsequent visits (onConflictDoUpdate is idempotent).
  const db = await getDb();
  const uid = session.user.id;
  const uname = session.user.name ?? "";
  const uemail = session.user.email ?? "";
  const urole = member.role;

  // Remove any stale row created with the same email but a wrong platform ID.
  // This can happen when a previous invitation acceptance bug inserted the user
  // directly into the tenant DB instead of the platform DB, generating a mismatch.
  if (uemail) {
    await db.delete(users).where(and(eq(users.email, uemail), ne(users.id, uid)));
  }

  await db
    .insert(users)
    .values({ id: uid, name: uname, email: uemail, role: urole })
    .onConflictDoUpdate({ target: users.id, set: { name: uname, role: urole } });
  // ─────────────────────────────────────────────────────────────────────────────

  // The sidebar is built from the membership role read above — the authoritative
  // one — rather than the platform staff field the pages used to consult.
  const entitlements = await getTenantEntitlements().catch(() => null);
  // Strings only. Sending the filtered menu itself carried each entry's `icon`,
  // a React component, which cannot cross into a Client Component — and took every
  // dashboard page down with it.
  const navAccess = computeNavAccess(sidebarItems, {
    actor: {
      userId: uid,
      tenantRole: normalizeTenantRole(member.role),
      isPlatformStaff: false,
    },
    enabledModules: entitlements?.enabledModules,
  });

  const cookieStore = await cookies();
  const userNotifications = session?.user?.id ? await getNotificationsAction() : [];
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const [variant, collapsible] = await Promise.all([
    getPreference("sidebar_variant", SIDEBAR_VARIANT_VALUES, "inset"),
    getPreference("sidebar_collapsible", SIDEBAR_COLLAPSIBLE_VALUES, "icon"),
  ]);

  return (
    <CurrencyProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar user={user} navAccess={navAccess} variant={variant} collapsible={collapsible} />
        <SidebarInset
          className={cn(
            "overflow-hidden",
            "[html[data-content-layout=centered]_&]:mx-auto! [html[data-content-layout=centered]_&]:max-w-screen-2xl!",
            "max-[113rem]:peer-data-[variant=inset]:mr-2! min-[101rem]:peer-data-[variant=inset]:peer-data-[state=collapsed]:mr-auto!",
          )}
        >
          <header
            className={cn(
              "flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
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
                {/* The palette offers verbs now, so it needs to know which are allowed. */}
                <SearchDialog tenantRole={normalizeTenantRole(member.role)} />
              </div>
              <div className="flex items-center gap-2">
                <RecentlyVisited />
                {session?.user?.id && <NotificationCenter notifications={userNotifications} userId={session.user.id} />}
                <CurrencySwitcher />
                <LocaleSwitcher />
                <LayoutControls />
                <ThemeSwitcher />
              </div>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
        </SidebarInset>
        {session?.user?.id && <ChatWidget userId={session.user.id} />}
      </SidebarProvider>
    </CurrencyProvider>
  );
}

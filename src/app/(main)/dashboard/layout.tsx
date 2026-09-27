import type { ReactNode } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { and, eq } from "drizzle-orm";

import { getNotificationsAction } from "@/actions/auth";
import { AppSidebar } from "@/app/(main)/dashboard/_components/sidebar/app-sidebar";
import { auth } from "@/auth";
import { ChatWidget } from "@/components/chat/chat-widget";
import { RecentlyVisited } from "@/components/crm/recently-visited";
import { WorkspaceScopeProvider } from "@/components/crm/workspace-scope";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { PushSubscriptionKeeper } from "@/components/pwa/push-subscription-keeper";
import { CurrencySwitcher } from "@/components/ui/currency-switcher";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CurrencyProvider } from "@/contexts/currency-context";
import { platformDb } from "@/db";
import { tenantMembers } from "@/db/schema";
import { getTenantEntitlements } from "@/lib/auth-guard";
import { ENTITIES, entityInPlan } from "@/lib/entities";
import { getTenantById } from "@/lib/get-tenant";
import { can, normalizeTenantRole } from "@/lib/permissions";
import { SIDEBAR_COLLAPSIBLE_VALUES, SIDEBAR_VARIANT_VALUES } from "@/lib/preferences/layout";
import { getDb } from "@/lib/tenant-context";
import { cn } from "@/lib/utils";
import { readWorkspaceFeatures } from "@/lib/workspace-features";
import { mirrorUser } from "@/lib/workspace-user-mirror";
import { computeNavAccess } from "@/navigation/sidebar/filter-nav";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";
import { getPreference } from "@/server/server-actions";

import { LayoutControls } from "./_components/sidebar/layout-controls";
import { MenuTrigger } from "./_components/sidebar/menu-trigger";
import { MobilePageTitle } from "./_components/sidebar/mobile-page-title";
import { MobileTabBar } from "./_components/sidebar/mobile-tab-bar";
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

  // The workspace and the membership are independent reads: side by side, not in turn.
  // The workspace row comes through the registry's cache, as `getDb()` reads it anyway.
  const [tenant, member] = await Promise.all([
    getTenantById(activeTenantId),
    platformDb
      .select()
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, activeTenantId), eq(tenantMembers.userId, session.user.id)))
      .then((rows) => rows[0]),
  ]);

  if (!tenant) redirect("/select-tenant");
  if (!member) redirect("/select-tenant");

  const db = await getDb();
  const uid = session.user.id;
  const uname = session.user.name ?? "";
  const uemail = session.user.email ?? "";
  const urole = member.role;

  // Everything the frame needs, at once: the person's row in the workspace, the plan, the
  // optional parts, the bell and the sidebar's preferences. Each used to wait for the last.
  const [, entitlements, features, userNotifications, variant, collapsible] = await Promise.all([
    mirrorUser(db, tenant.id, { id: uid, name: uname, email: uemail, role: urole }),
    // The sidebar is built from the membership role read above — the authoritative
    // one — rather than the platform staff field the pages used to consult.
    getTenantEntitlements().catch(() => null),
    // The optional parts the workspace uses — the menu drops the rest, and the chat widget,
    // which polls from every open tab, is not mounted at all when chat is off.
    readWorkspaceFeatures(db),
    getNotificationsAction(),
    getPreference("sidebar_variant", SIDEBAR_VARIANT_VALUES, "inset"),
    getPreference("sidebar_collapsible", SIDEBAR_COLLAPSIBLE_VALUES, "icon"),
  ]);
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
    features,
  });

  // What quick create and the palette may offer, decided here with the same role and
  // plan as the menu: strings only, so it can cross into the client components.
  const tenantRole = normalizeTenantRole(member.role);
  const enabledModules = entitlements?.enabledModules ?? null;
  const creatable = ENTITIES.filter(
    (e) => e.create && can(tenantRole, e.create.capability) && entityInPlan(e, enabledModules),
  ).map((e) => e.type);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <WorkspaceScopeProvider scope={tenant.id}>
      <CurrencyProvider>
        {/* ⚠️ Here and not in the root layout: it calls a server action that needs
          a session and a workspace, and the root layout also wraps the login
          page and the public quote page, where `getDb()` throws by design. */}
        <PushSubscriptionKeeper />
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar
            user={user}
            navAccess={navAccess}
            creatable={creatable}
            variant={variant}
            collapsible={collapsible}
          />
          <SidebarInset
            className={cn(
              // ⚠️ `clip`, not `hidden`, under a page that marks `data-sticky-sections`
              // (see the wrapper below): `hidden` makes this a scroll container that
              // never scrolls, and a sticky header inside it then never sticks.
              // `min-w-0` because `hidden` also let this flex item shrink below its
              // content, and `clip` does not: without it a tablet's page grew wider
              // than the screen and was cut off at the right.
              "overflow-hidden has-[[data-sticky-sections]]:min-w-0 has-[[data-sticky-sections]]:overflow-clip",
              "[html[data-content-layout=centered]_&]:mx-auto! [html[data-content-layout=centered]_&]:max-w-screen-2xl!",
              "max-[113rem]:peer-data-[variant=inset]:mr-2! min-[101rem]:peer-data-[variant=inset]:peer-data-[state=collapsed]:mr-auto!",
            )}
          >
            <header
              className={cn(
                "flex h-(--app-header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear",
                "[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:bg-background/50 [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
              )}
            >
              {/*
                One row that rearranges itself, rather than two layouts:

                - Phone: [‹ back] [page title ········] [search] [bell]. The menu
                  is the Menu slot of the bottom bar, so the trigger is not here;
                  the preferences that sat on the right live in that hub too.
                - md and up: [menu trigger | search ········] [recents] [bell]
                  [currency] [language] [layout] [theme], as it always was.
              */}
              <div className="flex w-full min-w-0 items-center gap-1 px-3 md:gap-2 md:px-4 lg:px-6">
                {/*
                  ⚠️ First on the left from md up, because that is the edge the
                  sidebar comes out of. Below md there is no sidebar to open: the
                  bottom bar's Menu opens the navigation hub from the bottom edge,
                  where the thumb already is.
                */}
                <div className="hidden shrink-0 items-center md:flex">
                  <MenuTrigger />
                  <Separator
                    orientation="vertical"
                    className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
                  />
                </div>
                {/* Installed, there is no address bar and no tab title, so the
                  app has to say where you are somewhere. */}
                <MobilePageTitle className="flex-1 md:hidden" />
                {/* The palette offers verbs now, so it needs to know which are allowed. */}
                <SearchDialog tenantRole={tenantRole} enabledModules={enabledModules} navAccess={navAccess} />
                <div className="hidden md:block md:flex-1" />
                <div className="flex shrink-0 items-center gap-1 md:gap-2">
                  {/* Desktop conveniences. Recently-visited duplicates the browser
                    history a phone already has, and the layout controls configure
                    a sidebar that does not exist below md. */}
                  <div className="hidden items-center gap-2 md:flex">
                    <RecentlyVisited />
                  </div>
                  {session?.user?.id && (
                    <NotificationCenter notifications={userNotifications} userId={session.user.id} />
                  )}
                  <div className="hidden items-center gap-2 md:flex">
                    <CurrencySwitcher />
                    <LocaleSwitcher />
                    <LayoutControls />
                    <ThemeSwitcher />
                  </div>
                </div>
              </div>
            </header>
            <OfflineBanner />
            {/*
            ⚠️ **This wrapper is the only owner of page padding.** It used to add
            p-4/p-6 on top of the p-6 that most pages set on their own root, so a
            375px phone spent 40px of its width on margins twice over. Pages
            below no longer set their own; a new one should not either.

            The bottom padding is the tab bar, which is fixed and would otherwise
            cover the last row of every scrollable page. The 1rem is also what the
            create button rises above the bar, and full-height screens (chat, a
            ticket) are sized to this exact sum — change one, change them.

            ⚠️ Nothing above this is bounded in height (the sidebar wrapper is
            `min-h-svh`), so it is the *document* that scrolls, and this box only
            grows. A page whose section headers stick while it scrolls (the pipeline
            list) marks itself `data-sticky-sections`: a box that is a scroll
            container but never scrolls is where a sticky header sticks — i.e. nowhere.
          */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(var(--mobile-nav-height)+var(--safe-bottom)+1rem)] has-[[data-sticky-sections]]:overflow-visible md:p-6 md:pb-6">
              {children}
            </div>
          </SidebarInset>
          <MobileTabBar navAccess={navAccess} creatable={creatable} user={user} />
          <InstallPrompt />
          {session?.user?.id && features.chat && <ChatWidget userId={session.user.id} />}
        </SidebarProvider>
      </CurrencyProvider>
    </WorkspaceScopeProvider>
  );
}

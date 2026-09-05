/**
 * What the sidebar shows, and what crosses the server/client boundary.
 *
 * The second half is why this file exists. The first version of `filter-nav`
 * returned the filtered menu and the layout passed it to a Client Component. Every
 * entry carries `icon`, a React component, and React refuses to serialise one:
 *
 *     Functions cannot be passed directly to Client Components
 *
 * Nothing caught it. The types were satisfied, the build succeeded, the tests were
 * green and the dev server tolerated it. It failed in production, on every
 * dashboard page, for every user.
 *
 * So the test is not "does the filtering work" alone — it is "is the thing we hand
 * across the boundary made of data".
 */
import { describe, expect, it } from "vitest";

import type { Actor } from "@/lib/permissions";

import { applyNavAccess, computeNavAccess, type NavAccess } from "./filter-nav";
import { accountPlacement, type NavGroup, sidebarItems, sidebarPlacement } from "./sidebar-items";

const viewer: Actor = { userId: "u1", tenantRole: "viewer", isPlatformStaff: false };
const editor: Actor = { userId: "u2", tenantRole: "editor", isPlatformStaff: false };
const admin: Actor = { userId: "u3", tenantRole: "admin", isPlatformStaff: false };
const owner: Actor = { userId: "u4", tenantRole: "owner", isPlatformStaff: false };

const ALL_MODULES = ["crm", "sales", "marketing", "support", "automation", "reporting", "helpdesk"];

function urlsOf(groups: NavGroup[]): string[] {
  return groups.flatMap((g) => g.items.flatMap((i) => [i.url, ...(i.subItems ?? []).map((s) => s.url)]));
}

function menuFor(actor: Actor, enabledModules: readonly string[] = ALL_MODULES): NavGroup[] {
  return applyNavAccess(sidebarItems, computeNavAccess(sidebarItems, { actor, enabledModules }));
}

describe("what crosses the server/client boundary", () => {
  it("is plain data, with no functions anywhere in it", () => {
    const access = computeNavAccess(sidebarItems, { actor: admin, enabledModules: ALL_MODULES });

    // structuredClone throws on a function, which is exactly React's objection.
    expect(() => structuredClone(access)).not.toThrow();
    expect(JSON.parse(JSON.stringify(access))).toEqual(access);
  });

  it("carries no React component, however deeply nested", () => {
    const access = computeNavAccess(sidebarItems, { actor: viewer, enabledModules: [] }) as unknown;

    const functions: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "function") functions.push(path);
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(access, "access");

    expect(functions).toEqual([]);
  });

  it("says only which urls are hidden and which are locked", () => {
    const access = computeNavAccess(sidebarItems, { actor: viewer, enabledModules: ALL_MODULES });
    expect(Object.keys(access).sort()).toEqual(["hidden", "locked"]);
    expect(access.hidden.every((u) => typeof u === "string")).toBe(true);
    expect(Object.values(access.locked).every((m) => typeof m === "string")).toBe(true);
  });
});

describe("role decides what is in the menu", () => {
  it("hides administration from a viewer", () => {
    const urls = urlsOf(menuFor(viewer));
    expect(urls).not.toContain("/dashboard/users");
    expect(urls).not.toContain("/dashboard/settings");
    expect(urls).not.toContain("/dashboard/support/sla");
  });

  it("still gives a viewer the day-to-day screens", () => {
    const urls = urlsOf(menuFor(viewer));
    expect(urls).toContain("/dashboard/crm");
    expect(urls).toContain("/dashboard/contacts");
    expect(urls).toContain("/dashboard/pipeline");
    expect(urls).toContain("/dashboard/reports");
  });

  it("hides administration from an editor too", () => {
    const urls = urlsOf(menuFor(editor));
    expect(urls).not.toContain("/dashboard/users");
    expect(urls).not.toContain("/dashboard/settings/webhooks");
  });

  it("gives an admin the settings, including the two that had no entry at all", () => {
    const urls = urlsOf(menuFor(admin));
    // Pipeline stages and macros existed only at their URL before this (rilievo D-04).
    expect(urls).toContain("/dashboard/settings/pipeline");
    expect(urls).toContain("/dashboard/settings/macros");
    expect(urls).toContain("/dashboard/users");
  });

  it("gives the owner everything an admin has", () => {
    expect(urlsOf(menuFor(owner))).toEqual(expect.arrayContaining(urlsOf(menuFor(admin))));
  });

  it("drops a group once nothing in it survives", () => {
    const labels = menuFor(viewer).map((g) => g.labelKey);
    expect(labels).toContain("work");

    // Administration survives for a viewer, but only because the help centre is
    // in it and open to everybody: the group is what is left, not what was there.
    const administration = menuFor(viewer).find((g) => g.labelKey === "administration");
    expect(administration?.items.map((i) => i.url)).toEqual(["/dashboard/help"]);
  });
});

describe("plan decides what is locked", () => {
  it("shows a module outside the plan, rather than hiding it", () => {
    const menu = menuFor(admin, ["crm"]);
    const urls = urlsOf(menu);

    // Visible — a locked entry is the upgrade prompt, and hiding it removes it.
    expect(urls).toContain("/dashboard/marketing/campaigns");

    const marketing = menu.flatMap((g) => g.items).find((i) => i.url === "/dashboard/marketing/campaigns");
    expect(marketing?.locked).toBe(true);
    expect(marketing?.lockedModule).toBe("marketing");
  });

  it("leaves included modules unlocked", () => {
    const menu = menuFor(admin, ALL_MODULES);
    const marketing = menu.flatMap((g) => g.items).find((i) => i.url === "/dashboard/marketing/campaigns");
    expect(marketing?.locked).toBe(false);
  });

  it("does not gate anything when the plan is unknown", () => {
    const access = computeNavAccess(sidebarItems, { actor: admin });
    expect(access.locked).toEqual({});
  });

  it("locks a sub-item independently of its parent", () => {
    const menu = menuFor(admin, ["crm", "sales", "marketing", "support", "automation", "helpdesk"]);
    const settings = menu.flatMap((g) => g.items).find((i) => i.url === "/dashboard/reports");
    expect(settings?.locked).toBe(true);
    expect(settings?.lockedModule).toBe("reporting");
  });
});

describe("a sub-item is judged on its own", () => {
  // No entry in today's menu is stricter than its parent, so the real menu cannot
  // exercise this — and a mutation that stopped evaluating sub-items entirely went
  // unnoticed. The capability field exists per sub-item; this proves it is read.
  const menu: NavGroup[] = [
    {
      id: 1,
      labelKey: "test",
      items: [
        {
          titleKey: "parent",
          url: "/parent",
          need: "record:read",
          subItems: [
            { titleKey: "open", url: "/parent/open", need: "record:read" },
            { titleKey: "restricted", url: "/parent/restricted", need: "user:manage" },
            { titleKey: "paid", url: "/parent/paid", module: "marketing" },
          ],
        },
      ],
    },
  ];

  it("hides a sub-item the role cannot reach, keeping its parent", () => {
    const result = applyNavAccess(menu, computeNavAccess(menu, { actor: viewer, enabledModules: ALL_MODULES }));
    const urls = urlsOf(result);

    expect(urls).toContain("/parent");
    expect(urls).toContain("/parent/open");
    expect(urls).not.toContain("/parent/restricted");
  });

  it("keeps a sub-item the role can reach", () => {
    const urls = urlsOf(applyNavAccess(menu, computeNavAccess(menu, { actor: admin, enabledModules: ALL_MODULES })));
    expect(urls).toContain("/parent/restricted");
  });

  it("locks a sub-item whose module is outside the plan", () => {
    const result = applyNavAccess(menu, computeNavAccess(menu, { actor: admin, enabledModules: ["crm"] }));
    const paid = result[0].items[0].subItems?.find((s) => s.url === "/parent/paid");

    expect(paid).toBeDefined();
    expect(paid?.locked).toBe(true);
    expect(paid?.lockedModule).toBe("marketing");
  });
});

describe("applyNavAccess", () => {
  it("returns the whole menu when nothing is hidden or locked", () => {
    const empty: NavAccess = { hidden: [], locked: {} };
    expect(urlsOf(applyNavAccess(sidebarItems, empty))).toEqual(urlsOf([...sidebarItems]));
  });

  it("keeps the icons, because they never left the client", () => {
    const menu = menuFor(admin);
    const withIcon = menu.flatMap((g) => g.items).filter((i) => i.icon);
    expect(withIcon.length).toBeGreaterThan(0);
  });
});

describe("where a group is drawn", () => {
  // Administration lives in the account menu rather than the list of
  // destinations, and the split happens *after* filtering. Splitting first, or
  // filtering the two surfaces separately, is how a menu ends up offering a
  // viewer the settings it spent this whole file keeping away from them.
  it("splits every group into exactly one of the two surfaces", () => {
    const menu = menuFor(owner);
    const drawn = [...sidebarPlacement(menu), ...accountPlacement(menu)];

    expect(drawn).toHaveLength(menu.length);
    expect(urlsOf(drawn).sort()).toEqual(urlsOf(menu).sort());
  });

  it("keeps administration out of the list of destinations", () => {
    const urls = urlsOf(sidebarPlacement(menuFor(owner)));
    expect(urls).not.toContain("/dashboard/users");
    expect(urls).not.toContain("/dashboard/settings");
  });

  it("gives an admin administration in the account menu", () => {
    const urls = urlsOf(accountPlacement(menuFor(admin)));
    expect(urls).toContain("/dashboard/users");
    expect(urls).toContain("/dashboard/settings/pipeline");
    expect(urls).toContain("/dashboard/settings/api");
  });

  it("gives a viewer an account menu with nothing administrative in it", () => {
    // Not merely hidden from the sidebar: absent from the surface it moved to.
    const urls = urlsOf(accountPlacement(menuFor(viewer)));
    expect(urls).not.toContain("/dashboard/users");
    expect(urls).not.toContain("/dashboard/settings");
    expect(urls).not.toContain("/dashboard/settings/api");
  });

  it("gives an editor the help centre but not the settings", () => {
    const urls = urlsOf(accountPlacement(menuFor(editor)));
    expect(urls).toContain("/dashboard/help");
    expect(urls).not.toContain("/dashboard/settings/webhooks");
  });
});

describe("the shape of the menu itself", () => {
  it("has no heading over a single entry", () => {
    // A group of one costs a line and says nothing; Automation used to be one.
    for (const group of sidebarItems) {
      expect(group.items.length, `group ${group.labelKey}`).toBeGreaterThan(1);
    }
  });

  it("gives every entry a distinct url", () => {
    const urls = urlsOf([...sidebarItems]);
    expect(new Set(urls).size, `duplicates in ${urls.join(", ")}`).toBe(urls.length);
  });
});

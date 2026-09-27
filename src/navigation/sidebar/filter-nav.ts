/**
 * filter-nav.ts — decides what each person sees in the sidebar.
 *
 * The sidebar rendered the full menu to everybody. Two different failures came
 * out of that (audit rilievi D-08, U-02):
 *
 *   • A `viewer` saw Users and Settings, clicked, and was redirected away with no
 *     message — which reads as the application ignoring the click.
 *   • A workspace whose plan excludes a module saw it, clicked, and was sent to
 *     billing, which sent it back to the dashboard. A loop with no explanation,
 *     and the largest missed upgrade prompt in the product.
 *
 * ⚠️⚠️ The decision is computed on the server and applied on the client, and the
 * two halves exchange **strings only**.
 *
 * The first version of this file returned the filtered `NavGroup[]` and the layout
 * handed it to `<AppSidebar>` as a prop. Every entry carries `icon: LucideIcon`,
 * which is a React component, and a React component cannot cross the
 * server/client boundary. React refused with
 *
 *     Functions cannot be passed directly to Client Components
 *     {$$typeof: ..., render: function, displayName: ...}
 *
 * and every dashboard page failed to render — in production, where the dev
 * server's tolerance no longer applied. The nav list therefore stays where it was,
 * imported directly by the client component, and only the verdict travels.
 */
import { type Actor, type Capability, can } from "@/lib/permissions";
import type { WorkspaceFeature, WorkspaceFeatures } from "@/lib/workspace-feature-list";

import type { NavGroup, NavModule, NavSubItem } from "./sidebar-items";

export interface NavVisibilityContext {
  actor: Actor;
  /** Modules included in the tenant's plan. Undefined means "do not gate". */
  enabledModules?: readonly string[];
  /** The workspace's optional parts. Undefined means all on. */
  features?: WorkspaceFeatures;
}

/**
 * What the server decided, as plain data.
 *
 * Keyed by url, because that is unique across the whole menu and is already a
 * string. Nothing here is a function, a component or a class, which is the point.
 */
export interface NavAccess {
  /** Urls the actor's role does not allow: removed from the menu. */
  hidden: string[];
  /** Url → the plan module missing for it: shown, but locked. */
  locked: Record<string, NavModule>;
  /**
   * Urls this person may open but rarely needs — the catalogue, contracts, campaigns, the
   * analysis views that are tabs inside Pipeline anyway: left out of their menu until they
   * ask for all of it, and always found by the palette (§4.1).
   */
  secondary: string[];
}

function allowedByRole(need: Capability | undefined, actor: Actor): boolean {
  return !need || can(actor, need);
}

function lockedByPlan(module: NavModule | undefined, enabled: readonly string[] | undefined): boolean {
  if (!module || !enabled) return false;
  return !enabled.includes(module);
}

/** Runs on the server, where the role and the plan are known. */
export function computeNavAccess(groups: readonly NavGroup[], ctx: NavVisibilityContext): NavAccess {
  const { actor, enabledModules, features } = ctx;
  const hidden: string[] = [];
  const locked: Record<string, NavModule> = {};
  const secondary: string[] = [];
  // Managers get the whole menu; everybody else the day's work first.
  const manager = can(actor, "record:manageAny");

  const consider = (entry: {
    url: string;
    need?: Capability;
    module?: NavModule;
    feature?: WorkspaceFeature;
    audience?: "manager";
  }) => {
    // Switched off by the workspace: gone, not locked — nothing is for sale here.
    if (entry.feature && features && !features[entry.feature]) {
      hidden.push(entry.url);
      return;
    }
    if (!allowedByRole(entry.need, actor)) {
      hidden.push(entry.url);
      return;
    }
    if (entry.module && lockedByPlan(entry.module, enabledModules)) {
      locked[entry.url] = entry.module;
    }
    if (entry.audience === "manager" && !manager) secondary.push(entry.url);
  };

  for (const group of groups) {
    for (const item of group.items) {
      consider(item);
      for (const sub of item.subItems ?? []) consider(sub);
    }
  }

  return { hidden, locked, secondary };
}

/**
 * Runs on the client, against the nav list it imported itself.
 *
 * A group with nothing left in it disappears, so no empty headings are rendered.
 */
export function applyNavAccess(
  groups: readonly NavGroup[],
  access: NavAccess,
  /** Leave out what is secondary for this person: the menu, unless they asked for all of it. */
  options: { focused?: boolean } = {},
): NavGroup[] {
  const hidden = new Set([...access.hidden, ...(options.focused ? (access.secondary ?? []) : [])]);
  const result: NavGroup[] = [];

  for (const group of groups) {
    const items = group.items
      .filter((item) => !hidden.has(item.url))
      .map((item) => {
        const subItems: NavSubItem[] = (item.subItems ?? [])
          .filter((s) => !hidden.has(s.url))
          .map((s) => ({ ...s, locked: Boolean(access.locked[s.url]), lockedModule: access.locked[s.url] }));

        return {
          ...item,
          ...(item.subItems ? { subItems } : {}),
          locked: Boolean(access.locked[item.url]),
          lockedModule: access.locked[item.url],
        };
      })
      // A parent with no page of its own and no children left is an empty menu.
      .filter((item) => item.url || (item.subItems?.length ?? 0) > 0);

    if (items.length > 0) result.push({ ...group, items });
  }

  return result;
}

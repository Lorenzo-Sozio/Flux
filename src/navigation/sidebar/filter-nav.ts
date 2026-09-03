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
 * Entries the role cannot use are removed. Entries the *plan* does not include
 * stay visible and locked, because that is a thing worth buying, not a thing to
 * hide.
 */
import { type Actor, type Capability, can } from "@/lib/permissions";

import type { NavGroup, NavMainItem, NavModule, NavSubItem } from "./sidebar-items";

export interface NavVisibilityContext {
  actor: Actor;
  /** Modules included in the tenant's plan. Undefined means "do not gate". */
  enabledModules?: readonly string[];
}

function allowedByRole(need: Capability | undefined, actor: Actor): boolean {
  return !need || can(actor, need);
}

function lockedByPlan(module: NavModule | undefined, enabled: readonly string[] | undefined): boolean {
  if (!module || !enabled) return false;
  return !enabled.includes(module);
}

/**
 * Returns the groups to render, with plan-locked entries marked rather than removed.
 * A group with nothing left in it disappears, so no empty headings are shown.
 */
export function filterNav(groups: readonly NavGroup[], ctx: NavVisibilityContext): NavGroup[] {
  const { actor, enabledModules } = ctx;

  const result: NavGroup[] = [];

  for (const group of groups) {
    const items: NavMainItem[] = [];

    for (const item of group.items) {
      if (!allowedByRole(item.need, actor)) continue;

      const subItems: NavSubItem[] = (item.subItems ?? [])
        .filter((s) => allowedByRole(s.need, actor))
        .map((s) => ({ ...s }));

      for (const sub of subItems) {
        if (lockedByPlan(sub.module, enabledModules)) {
          sub.locked = true;
          sub.lockedModule = sub.module;
        }
      }

      // A parent whose children are all gone and which has no page of its own is
      // an empty menu; drop it rather than render a dead heading.
      if (item.subItems && subItems.length === 0 && item.subItems.length > 0 && !item.url) continue;

      const entry: NavMainItem = {
        ...item,
        ...(item.subItems ? { subItems } : {}),
      };

      if (lockedByPlan(item.module, enabledModules)) {
        entry.locked = true;
        entry.lockedModule = item.module;
      }

      items.push(entry);
    }

    if (items.length > 0) result.push({ ...group, items });
  }

  return result;
}

/**
 * Which dashboard the home opens on: one per kind of work, chosen by each person in
 * their Profile (`user_preference.home_dashboard`).
 *
 * - sales         — a salesperson's own day: their numbers, work list, agenda. (Was "me".)
 * - salesManager  — the team this month: won against target, open pipeline, who is where.
 * - admin         — money: what is owed and overdue, drafts, orders to invoice, commissions.
 * - support       — the desk: open, unassigned, late against the SLA, satisfaction.
 * - direction     — the state of the business at a glance. (Was "company".)
 *
 * ⚠️ Each one reads only its own figures. The home used to pay for the company's dozen
 * statements on every visit and throw them away on the personal view.
 *
 * A module of its own, with no React: the page, the Profile and the tests all read it.
 */

export const HOME_DASHBOARDS = ["sales", "salesManager", "admin", "support", "direction"] as const;
export type HomeDashboard = (typeof HOME_DASHBOARDS)[number];

/** What decides which dashboards a person may open: their capabilities and the plan's modules. */
export interface DashboardAccess {
  /** `report:read` — the team's figures. */
  readsReports: boolean;
  /** `settings:manage` — invoices, receivables and commissions are an administrator's. */
  managesSettings: boolean;
  /** `record:manageAny` — opens on the business rather than on their own work. */
  managesEveryRecord: boolean;
  hasSales: boolean;
  hasSupport: boolean;
}

/** The dashboards this person can open, in the order the menu lists them. */
export function availableDashboards(access: DashboardAccess): HomeDashboard[] {
  return HOME_DASHBOARDS.filter((d) => {
    if (d === "salesManager") return access.readsReports;
    if (d === "admin") return access.managesSettings && access.hasSales;
    if (d === "support") return access.hasSupport;
    return true;
  });
}

/** A dashboard named anywhere: the address, the saved preference. The old view names still work. */
export function parseHomeDashboard(value: string | string[] | null | undefined): HomeDashboard | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  if ((HOME_DASHBOARDS as readonly string[]).includes(v)) return v as HomeDashboard;
  // ?view=me / ?view=company (and "team", the company view's first name) from old links.
  if (v === "me") return "sales";
  if (v === "company" || v === "team") return "direction";
  return null;
}

/** With nothing chosen: whoever manages every record opens on the business, everybody else on their work. */
export function defaultDashboard(access: DashboardAccess): HomeDashboard {
  return access.managesEveryRecord ? "direction" : "sales";
}

/**
 * The address wins (a link to a dashboard opens it), then the person's saved choice, then
 * the role. A choice the person can no longer open — a module dropped from the plan, a
 * role lowered — falls through rather than showing figures they may not read.
 */
export function resolveHomeDashboard(
  input: { fromUrl?: string | string[]; saved?: string | null },
  access: DashboardAccess,
): HomeDashboard {
  const allowed = availableDashboards(access);
  for (const candidate of [parseHomeDashboard(input.fromUrl), parseHomeDashboard(input.saved)]) {
    if (candidate && allowed.includes(candidate)) return candidate;
  }
  return defaultDashboard(access);
}

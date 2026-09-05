import {
  Activity,
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  ChartBar,
  CheckSquare,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  FileText,
  GanttChartSquare,
  GitMerge,
  HelpCircle,
  Kanban,
  KeyRound,
  LifeBuoy,
  LineChart,
  type LucideIcon,
  Mail,
  MailOpen,
  MessageCircle,
  MessageSquare,
  Package,
  Settings,
  Settings2,
  ShoppingCart,
  Swords,
  Target,
  TrendingUp,
  Users,
  Users2,
  Wand2,
  Webhook,
  Zap,
} from "lucide-react";

import type { Capability } from "@/lib/permissions";

/** Plan modules a nav entry can belong to. */
export type NavModule = "crm" | "sales" | "marketing" | "support" | "automation" | "reporting" | "helpdesk";

export interface NavSubItem {
  titleKey: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
  /**
   * The capability needed to open this. The sidebar used to show every module to
   * everybody: a viewer saw Users and Settings and was bounced without a word on
   * clicking, and a workspace whose plan excluded a module saw it and was
   * redirected straight back to where it started (audit rilievi D-08, U-02).
   */
  need?: Capability;
  /** Plan module this belongs to. Absent means always available. */
  module?: NavModule;
  /** Set by `filterNav` when the plan excludes this entry. Shown, not hidden. */
  locked?: boolean;
  lockedModule?: NavModule;
}

export interface NavMainItem {
  titleKey: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
  need?: Capability;
  module?: NavModule;
  locked?: boolean;
  lockedModule?: NavModule;
}

export interface NavGroup {
  id: number;
  labelKey?: string;
  /**
   * Where the group is drawn: the list of destinations, or the account menu at
   * the foot of the sidebar.
   *
   * ⚠️ An account group is still part of `sidebarItems` on purpose. The
   * capability and plan filtering runs once, over this whole structure, so the
   * rules that keep a viewer out of Users and Settings cannot end up applying to
   * one surface and not the other. A second, separately filtered menu is exactly
   * how that guarantee gets lost.
   */
  placement?: "sidebar" | "account";
  items: NavMainItem[];
}

/**
 * The menu, arranged by the question being asked rather than by which part of the
 * codebase answers it.
 *
 * Three rules hold it together, each one here because breaking it is what made
 * the previous version hard to read:
 *
 * 1. **A sub-view lives under its screen.** Targets, the funnel, win/loss, the
 *    forecast and the pipeline report are five ways of looking at the pipeline,
 *    not five destinations beside it. Flat, they made the sales group eight items
 *    long and gave "Pipeline" and "Sales funnel" equal rank, which they have
 *    never had.
 * 2. **No group holds fewer than two items.** A heading over a single link costs
 *    a line and says nothing; Automation was exactly that.
 * 3. **Every page is either in here or deleted.** The support overview, the sales
 *    analytics screen, the pipeline report and the API keys page all existed and
 *    were reachable only by typing the path.
 */
export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    labelKey: "work",
    items: [
      // Where the day starts, and the page the dashboard opens on. A separate
      // "Today" screen sat here for a while; it drew the same agenda, the same
      // work list and the same ticket queue as this one, so it was a second copy
      // of the first half of a page everybody already lands on.
      { titleKey: "dashboard", url: "/dashboard/crm", icon: ChartBar },
      { titleKey: "calendar", url: "/dashboard/calendar", icon: Calendar },
      {
        titleKey: "tasks",
        url: "/dashboard/tasks",
        icon: CheckSquare,
        subItems: [
          { titleKey: "gantt", url: "/dashboard/tasks/gantt", icon: GanttChartSquare },
          { titleKey: "workload", url: "/dashboard/tasks/workload", icon: Users2 },
        ],
      },
      { titleKey: "chat", url: "/dashboard/chat", icon: MessageCircle },
    ],
  },
  {
    id: 2,
    labelKey: "customers",
    items: [
      // People and companies before leads: a lead is what a contact is before it
      // is one, and the old order put the pipeline's raw material above the
      // records the rest of the product is built on.
      { titleKey: "contacts", url: "/dashboard/contacts", icon: Contact },
      { titleKey: "companies", url: "/dashboard/companies", icon: Building2 },
      { titleKey: "leads", url: "/dashboard/leads", icon: Users },
    ],
  },
  {
    id: 3,
    labelKey: "sales",
    items: [
      {
        titleKey: "pipeline",
        url: "/dashboard/pipeline",
        icon: Kanban,
        module: "sales",
        subItems: [
          { titleKey: "salesTargets", url: "/dashboard/pipeline/targets", icon: TrendingUp, module: "sales" },
          { titleKey: "salesFunnel", url: "/dashboard/pipeline/funnel", icon: GitMerge, module: "sales" },
          { titleKey: "winLoss", url: "/dashboard/pipeline/win-loss", icon: Swords, module: "sales" },
          { titleKey: "forecast", url: "/dashboard/pipeline/forecast", icon: LineChart, module: "sales" },
          { titleKey: "pipelineReport", url: "/dashboard/pipeline/report", icon: ClipboardList, module: "sales" },
        ],
      },
      { titleKey: "quotes", url: "/dashboard/sales/quotes", icon: FileText, module: "sales" },
      { titleKey: "orders", url: "/dashboard/sales/orders", icon: ShoppingCart, module: "sales" },
      { titleKey: "products", url: "/dashboard/sales/products", icon: Package, module: "sales" },
      { titleKey: "finance", url: "/dashboard/sales/finance", icon: Banknote, module: "sales" },
    ],
  },
  {
    id: 4,
    labelKey: "support",
    items: [
      { titleKey: "supportOverview", url: "/dashboard/support", icon: LifeBuoy, module: "support" },
      { titleKey: "tickets", url: "/dashboard/support/tickets", icon: MessageSquare, module: "support" },
      {
        titleKey: "slaManagement",
        url: "/dashboard/support/sla",
        icon: Clock,
        module: "support",
        need: "sla:manage",
      },
      // Macros are canned replies to a customer, so they sit beside the tickets
      // they are typed into. The URL stays under /settings because that is where
      // the page lives; the menu is about meaning, not paths.
      {
        titleKey: "macros",
        url: "/dashboard/settings/macros",
        icon: MessageCircle,
        module: "support",
        need: "macro:manage",
      },
    ],
  },
  {
    id: 5,
    labelKey: "outreach",
    items: [
      // Campaigns, the templates they send, and the rules that send things without
      // anyone clicking. Automation was a group of one, which read as a product
      // area of its own; it is not one, it is how the other areas do their work.
      { titleKey: "campaigns", url: "/dashboard/marketing/campaigns", icon: Target, module: "marketing" },
      { titleKey: "templates", url: "/dashboard/marketing/templates", icon: Mail, module: "marketing" },
      { titleKey: "automations", url: "/dashboard/automation", icon: Zap, module: "automation" },
    ],
  },
  {
    id: 6,
    labelKey: "analysis",
    items: [
      { titleKey: "salesTrend", url: "/dashboard/analytics", icon: Activity, module: "sales" },
      {
        titleKey: "reports",
        url: "/dashboard/reports",
        icon: BarChart3,
        module: "reporting",
        need: "report:read",
        subItems: [{ titleKey: "reportBuilder", url: "/dashboard/reports/builder", icon: Wand2, need: "report:read" }],
      },
    ],
  },
  {
    id: 7,
    labelKey: "administration",
    placement: "account",
    items: [
      { titleKey: "users", url: "/dashboard/users", icon: Users, need: "user:read" },
      {
        titleKey: "settings",
        url: "/dashboard/settings",
        icon: Settings,
        need: "settings:read",
        subItems: [
          { titleKey: "billing", url: "/dashboard/settings/billing", icon: CreditCard, need: "billing:read" },
          // Pipeline stages existed only at its URL: absent from the sidebar AND
          // from the settings index, so configuring the pipeline — the first thing
          // anyone does — meant typing the path (audit rilievo D-04).
          { titleKey: "pipelineStages", url: "/dashboard/settings/pipeline", icon: GitMerge, need: "pipeline:manage" },
          {
            titleKey: "customFields",
            url: "/dashboard/settings/custom-fields",
            icon: Settings2,
            need: "customField:manage",
          },
          { titleKey: "email", url: "/dashboard/settings/email", icon: MailOpen, need: "emailSettings:manage" },
          { titleKey: "webhooks", url: "/dashboard/settings/webhooks", icon: Webhook, need: "webhook:manage" },
          { titleKey: "apiKeys", url: "/dashboard/settings/api", icon: KeyRound, need: "settings:manage" },
        ],
      },
      { titleKey: "help", url: "/dashboard/help", icon: HelpCircle },
    ],
  },
];

/** The groups drawn in the sidebar itself. */
export function sidebarPlacement(groups: readonly NavGroup[]): NavGroup[] {
  return groups.filter((g) => g.placement !== "account");
}

/** The groups drawn in the account menu at the foot of the sidebar. */
export function accountPlacement(groups: readonly NavGroup[]): NavGroup[] {
  return groups.filter((g) => g.placement === "account");
}

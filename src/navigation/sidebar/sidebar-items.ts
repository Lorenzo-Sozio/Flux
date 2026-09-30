import {
  Banknote,
  BarChart3,
  BellRing,
  Bot,
  Building2,
  Calendar,
  ChartBar,
  CheckSquare,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  FileInput,
  FileText,
  GanttChartSquare,
  Gauge,
  GitMerge,
  HandCoins,
  HelpCircle,
  Kanban,
  KeyRound,
  Landmark,
  LifeBuoy,
  LineChart,
  ListOrdered,
  ListTree,
  type LucideIcon,
  Mail,
  MailOpen,
  MapPin,
  MessageCircle,
  MessageSquare,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Settings2,
  ShoppingCart,
  Swords,
  Tags,
  Target,
  ToggleRight,
  TrendingUp,
  UserRound,
  Users,
  Users2,
  Wand2,
  Webhook,
  Zap,
} from "lucide-react";

import type { Capability } from "@/lib/permissions";
import type { WorkspaceFeature } from "@/lib/workspace-feature-list";

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
  /** An optional part the workspace can switch off: hidden, not locked, when it is off. */
  feature?: WorkspaceFeature;
  /** Set by `filterNav` when the plan excludes this entry. Shown, not hidden. */
  locked?: boolean;
  lockedModule?: NavModule;
  /**
   * `manager`: in the menu of whoever runs the workspace; for everybody else behind "show
   * all sections", and always in the palette (§4.1). Never a permission — `need` is that.
   */
  audience?: "manager";
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
  feature?: WorkspaceFeature;
  locked?: boolean;
  lockedModule?: NavModule;
  audience?: "manager";
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
          { titleKey: "gantt", url: "/dashboard/tasks/gantt", icon: GanttChartSquare, feature: "projects" },
          { titleKey: "workload", url: "/dashboard/tasks/workload", icon: Users2, feature: "projects" },
        ],
      },
      { titleKey: "chat", url: "/dashboard/chat", icon: MessageCircle, feature: "chat" },
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
      // The text an email to a customer starts from, beside the records it is written from —
      // like the macros beside the tickets. For everybody: writing to customers needs no module.
      { titleKey: "emailTemplates", url: "/dashboard/settings/email-templates", icon: FileText, need: "record:read" },
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
          // The analysis views are also the tabs across the Pipeline section, so a salesperson
          // reaches them from the board without six more lines in the menu.
          {
            titleKey: "salesTargets",
            url: "/dashboard/pipeline/targets",
            icon: TrendingUp,
            module: "sales",
            audience: "manager",
          },
          // Not for managers only: what a person's own wins earned is theirs to see.
          {
            titleKey: "commissions",
            url: "/dashboard/pipeline/commissions",
            icon: HandCoins,
            module: "sales",
          },
          {
            titleKey: "salesFunnel",
            url: "/dashboard/pipeline/funnel",
            icon: GitMerge,
            module: "sales",
            audience: "manager",
          },
          {
            titleKey: "winLoss",
            url: "/dashboard/pipeline/win-loss",
            icon: Swords,
            module: "sales",
            audience: "manager",
          },
          {
            titleKey: "territoryReport",
            url: "/dashboard/pipeline/territories",
            icon: MapPin,
            module: "sales",
            need: "report:read",
            audience: "manager",
          },
          {
            titleKey: "forecast",
            url: "/dashboard/pipeline/forecast",
            icon: LineChart,
            module: "sales",
            audience: "manager",
          },
          {
            titleKey: "pipelineReport",
            url: "/dashboard/pipeline/report",
            icon: ClipboardList,
            module: "sales",
            audience: "manager",
          },
        ],
      },
      { titleKey: "quotes", url: "/dashboard/sales/quotes", icon: FileText, module: "sales" },
      {
        titleKey: "contracts",
        url: "/dashboard/sales/contracts",
        icon: ScrollText,
        module: "sales",
        audience: "manager",
      },
      { titleKey: "invoices", url: "/dashboard/sales/invoices", icon: Receipt, module: "sales", audience: "manager" },
      { titleKey: "orders", url: "/dashboard/sales/orders", icon: ShoppingCart, module: "sales" },
      { titleKey: "products", url: "/dashboard/sales/products", icon: Package, module: "sales", audience: "manager" },
      // Beside the catalogue, because a price list is the catalogue for one group
      // of customers — not a separate thing they buy.
      { titleKey: "priceLists", url: "/dashboard/sales/price-lists", icon: Tags, module: "sales", audience: "manager" },
    ],
  },
  {
    id: 4,
    labelKey: "support",
    items: [
      { titleKey: "supportOverview", url: "/dashboard/support", icon: LifeBuoy, module: "support" },
      { titleKey: "tickets", url: "/dashboard/support/tickets", icon: MessageSquare, module: "support" },
      // The desk person by person (§12.2): here rather than under Reports, which is a module
      // of its own, because a support lead needs it whether or not the workspace bought that.
      {
        titleKey: "supportAgents",
        url: "/dashboard/support/agents",
        icon: ChartBar,
        module: "support",
        need: "report:read",
        audience: "manager",
      },
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
      {
        titleKey: "campaigns",
        url: "/dashboard/marketing/campaigns",
        icon: Target,
        module: "marketing",
        audience: "manager",
      },
      { titleKey: "templates", url: "/dashboard/marketing/templates", icon: Mail, module: "marketing" },
      { titleKey: "sequences", url: "/dashboard/marketing/sequences", icon: ListOrdered, module: "marketing" },
      { titleKey: "automations", url: "/dashboard/automation", icon: Zap, module: "automation", audience: "manager" },
    ],
  },
  {
    id: 6,
    labelKey: "analysis",
    items: [
      // ⚠️ Finance moved here from Sales when the analytics screen was deleted,
      // and it belongs here on its own merits: it is a revenue trend and a
      // spending breakdown, not a thing you write. It also keeps this group
      // above one entry, which is the line between a heading and a label.
      // ⚠️ The page is an administrator's (settings:manage) and the entry had no need, so
      // every editor saw it and was bounced on clicking.
      {
        titleKey: "finance",
        url: "/dashboard/sales/finance",
        icon: Banknote,
        module: "sales",
        need: "settings:manage",
      },
      // Bank reconciliation (I13): the statement beside what customers owe. Admin, like the page.
      {
        titleKey: "bank",
        url: "/dashboard/sales/bank",
        icon: Landmark,
        module: "sales",
        need: "bank:reconcile",
      },
      // ⚠️ Here rather than beside the orders, where it used to sit: it is not a sales
      // number. It says what the thing writing into this CRM has been doing — leads,
      // notes, activities, custom fields, orders — and the orders were only one of them.
      //
      // ⚠️ And **not** under `/dashboard/reports`, which is behind the reporting module:
      // whoever connects an assistant needs to see what it does whether or not they bought
      // a reports package. It reads only this database, so it opens with no assistant
      // connected and shows nothing, which is the truth.
      {
        titleKey: "assistantContribution",
        url: "/dashboard/assistant",
        icon: Bot,
        need: "report:read",
        audience: "manager",
      },
      {
        titleKey: "reports",
        url: "/dashboard/reports",
        icon: BarChart3,
        module: "reporting",
        need: "report:read",
        subItems: [
          { titleKey: "repScorecard", url: "/dashboard/reports/scorecard", icon: Gauge, need: "report:read" },
          { titleKey: "reportBuilder", url: "/dashboard/reports/builder", icon: Wand2, need: "report:read" },
        ],
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
          { titleKey: "general", url: "/dashboard/settings/general", icon: Building2, need: "settings:manage" },
          { titleKey: "billing", url: "/dashboard/settings/billing", icon: CreditCard, need: "billing:read" },
          { titleKey: "features", url: "/dashboard/settings/features", icon: ToggleRight, need: "settings:manage" },
          // Pipeline stages existed only at its URL: absent from the sidebar AND
          // from the settings index, so configuring the pipeline — the first thing
          // anyone does — meant typing the path (audit rilievo D-04).
          { titleKey: "pipelineStages", url: "/dashboard/settings/pipeline", icon: GitMerge, need: "pipeline:manage" },
          {
            titleKey: "territories",
            url: "/dashboard/settings/territories",
            icon: MapPin,
            need: "territory:manage",
            module: "sales",
          },
          {
            titleKey: "invoicing",
            url: "/dashboard/settings/invoicing",
            icon: Receipt,
            need: "invoicing:manage",
            module: "sales",
          },
          { titleKey: "lists", url: "/dashboard/settings/lists", icon: ListTree, need: "settings:manage" },
          { titleKey: "webForms", url: "/dashboard/settings/forms", icon: FileInput, need: "settings:manage" },
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
      // Personal, so for everybody: their own name and password. Changing one's password was
      // only possible from Users, which is for administrators.
      { titleKey: "profile", url: "/dashboard/profile", icon: UserRound, need: "record:read" },
      // ⚠️ Personal, so for everybody: what reaches this person's phone. It was reachable from
      // the bell and nowhere else, because the settings index that listed it is for admins.
      {
        titleKey: "notificationSettings",
        url: "/dashboard/settings/notifications",
        icon: BellRing,
        need: "record:read",
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

/**
 * Shortcuts in the phone's bottom bar.
 *
 * The bar is `[shortcut] [shortcut] (Create) [shortcut] [Menu]`: three
 * destinations, the create button in the middle where either thumb reaches it,
 * and the Menu last. The Menu is not a left-edge panel any more — it opens the
 * navigation hub from the bottom, the edge the thumb is already on, which is
 * what the old objection to a menu slot (a control on the right opening a panel
 * on the left) was about. Everything else is one tap into that hub.
 */
export const MOBILE_TAB_SLOTS = 3;

/**
 * The default order of those shortcuts, for someone who has not chosen their own.
 *
 * It runs longer than the bar, so a workspace without sales — or without
 * support — still gets a full bar instead of gaps.
 */
export const MOBILE_TAB_PREFERENCE = [
  "/dashboard/crm",
  "/dashboard/contacts",
  "/dashboard/calendar",
  "/dashboard/pipeline",
  "/dashboard/support/tickets",
  "/dashboard/tasks",
  "/dashboard/companies",
  "/dashboard/sales/orders",
] as const;

/**
 * The tabs for the bottom bar, chosen from an **already filtered** menu.
 *
 * ⚠️ It adds no permission rule of its own — it only orders what survived the
 * one in `filter-nav`. Anything it could add would be a second, quieter copy of
 * that rule, and the two would disagree the first time one of them changed. A
 * person's own choice of shortcuts comes in as `preference` and passes through
 * the same filter: a url the role cannot open is simply not found.
 *
 * Locked entries are skipped rather than shown. In the sidebar a locked module
 * is the upgrade prompt and worth its line; in three slots it is a third of the
 * navigation spent on something that does not open.
 */
export function pickMobileTabs(
  groups: readonly NavGroup[],
  {
    preference = MOBILE_TAB_PREFERENCE,
    limit = MOBILE_TAB_SLOTS,
  }: { preference?: readonly string[]; limit?: number } = {},
): NavMainItem[] {
  const reachable = new Map<string, NavMainItem>();
  // Sidebar groups only. Administration is drawn in the account menu, and a
  // phone's three slots are not where Settings and the help centre belong —
  // today's preference list happens not to name them, and this is what keeps
  // that true when somebody edits the list.
  for (const group of sidebarPlacement(groups)) {
    for (const item of group.items) {
      if (!item.locked) reachable.set(item.url, item);
    }
  }

  return preference
    .map((url) => reachable.get(url))
    .filter((item): item is NavMainItem => Boolean(item))
    .slice(0, limit);
}

/**
 * Everything that may be pinned to the bottom bar: what `pickMobileTabs` would
 * accept, in menu order. Built by asking it, so the list of choices and the
 * choice itself cannot disagree.
 */
export function mobileTabCandidates(groups: readonly NavGroup[]): NavMainItem[] {
  const everyUrl = sidebarPlacement(groups).flatMap((group) => group.items.map((item) => item.url));
  return pickMobileTabs(groups, { preference: everyUrl, limit: everyUrl.length });
}

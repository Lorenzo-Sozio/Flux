import {
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  ChartBar,
  CheckSquare,
  Clock,
  Contact,
  CreditCard,
  FileText,
  GanttChartSquare,
  GitMerge,
  HelpCircle,
  Kanban,
  type LucideIcon,
  Mail,
  MailOpen,
  MessageCircle,
  MessageSquare,
  Package,
  Settings,
  Settings2,
  ShoppingCart,
  Sunrise,
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
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    labelKey: "crm",
    items: [
      // First, because it is where the day starts. The dashboard below it answers
      // "how are we doing"; this one answers "what am I doing" (audit rilievo S-11).
      { titleKey: "today", url: "/dashboard/today", icon: Sunrise },
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
      { titleKey: "leads", url: "/dashboard/leads", icon: Users },
      { titleKey: "contacts", url: "/dashboard/contacts", icon: Contact },
      { titleKey: "companies", url: "/dashboard/companies", icon: Building2 },
    ],
  },
  {
    id: 2,
    labelKey: "sales",
    items: [
      { titleKey: "finance", url: "/dashboard/sales/finance", icon: Banknote, module: "sales" },
      { titleKey: "quotes", url: "/dashboard/sales/quotes", icon: FileText, module: "sales" },
      { titleKey: "products", url: "/dashboard/sales/products", icon: Package, module: "sales" },
      { titleKey: "orders", url: "/dashboard/sales/orders", icon: ShoppingCart, module: "sales" },
      { titleKey: "pipeline", url: "/dashboard/pipeline", icon: Kanban, module: "sales" },
      { titleKey: "salesTargets", url: "/dashboard/pipeline/targets", icon: TrendingUp, module: "sales" },
      { titleKey: "salesFunnel", url: "/dashboard/pipeline/funnel", icon: GitMerge, module: "sales" },
      { titleKey: "winLoss", url: "/dashboard/pipeline/win-loss", icon: Swords, module: "sales" },
    ],
  },
  {
    id: 3,
    labelKey: "automation",
    items: [{ titleKey: "rules", url: "/dashboard/automation", icon: Zap, module: "automation" }],
  },
  {
    id: 4,
    labelKey: "support",
    items: [
      { titleKey: "tickets", url: "/dashboard/support/tickets", icon: MessageSquare, module: "support" },
      {
        titleKey: "slaManagement",
        url: "/dashboard/support/sla",
        icon: Clock,
        module: "support",
        need: "sla:manage",
      },
    ],
  },
  {
    id: 5,
    labelKey: "marketing",
    items: [
      { titleKey: "templates", url: "/dashboard/marketing/templates", icon: Mail, module: "marketing" },
      { titleKey: "campaigns", url: "/dashboard/marketing/campaigns", icon: Target, module: "marketing" },
    ],
  },
  {
    id: 6,
    labelKey: "administration",
    items: [
      { titleKey: "users", url: "/dashboard/users", icon: Users, need: "user:read" },
      {
        titleKey: "reports",
        url: "/dashboard/reports",
        icon: BarChart3,
        module: "reporting",
        need: "report:read",
        subItems: [{ titleKey: "reportBuilder", url: "/dashboard/reports/builder", icon: Wand2, need: "report:read" }],
      },
      {
        titleKey: "settings",
        url: "/dashboard/settings",
        icon: Settings,
        need: "settings:read",
        subItems: [
          { titleKey: "billing", url: "/dashboard/settings/billing", icon: CreditCard, need: "billing:read" },
          // Pipeline stages and macros existed only at their URL: absent from the
          // sidebar AND from the settings index, so configuring the pipeline — the
          // first thing anyone does — meant typing the path (audit rilievo D-04).
          { titleKey: "pipelineStages", url: "/dashboard/settings/pipeline", icon: GitMerge, need: "pipeline:manage" },
          {
            titleKey: "customFields",
            url: "/dashboard/settings/custom-fields",
            icon: Settings2,
            need: "customField:manage",
          },
          { titleKey: "email", url: "/dashboard/settings/email", icon: MailOpen, need: "emailSettings:manage" },
          { titleKey: "macros", url: "/dashboard/settings/macros", icon: MessageSquare, need: "macro:manage" },
          { titleKey: "webhooks", url: "/dashboard/settings/webhooks", icon: Webhook, need: "webhook:manage" },
        ],
      },
      { titleKey: "help", url: "/dashboard/help", icon: HelpCircle },
    ],
  },
];

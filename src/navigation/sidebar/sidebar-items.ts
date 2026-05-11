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
  Fingerprint,
  GanttChartSquare,
  Gauge,
  GitMerge,
  HelpCircle,
  Kanban,
  type LucideIcon,
  Mail,
  MailOpen,
  MessageCircle,
  MessageSquare,
  Wand2,
  Package,
  Settings,
  Settings2,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Users2,
  Webhook,
  Zap,
  Shield,
} from "lucide-react";

export interface NavSubItem {
  titleKey: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  titleKey: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
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
      { titleKey: "chat", url: "/dashboard/chat", icon: MessageCircle, isNew: true },
      { titleKey: "leads", url: "/dashboard/leads", icon: Users },
      { titleKey: "contacts", url: "/dashboard/contacts", icon: Contact },
      { titleKey: "companies", url: "/dashboard/companies", icon: Building2 },
    ],
  },
  {
    id: 2,
    labelKey: "sales",
    items: [
      { titleKey: "finance", url: "/dashboard/sales/finance", icon: Banknote },
      { titleKey: "quotes", url: "/dashboard/sales/quotes", icon: FileText, isNew: true },
      { titleKey: "products", url: "/dashboard/sales/products", icon: Package, isNew: true },
      { titleKey: "orders", url: "/dashboard/sales/orders", icon: ShoppingCart, isNew: true },
      { titleKey: "pipeline", url: "/dashboard/pipeline", icon: Kanban },
      { titleKey: "salesTargets", url: "/dashboard/pipeline/targets", icon: TrendingUp, isNew: true },
      { titleKey: "salesFunnel", url: "/dashboard/pipeline/funnel", icon: GitMerge, isNew: true },
    ],
  },
  {
    id: 2.5,
    labelKey: "automation",
    items: [{ titleKey: "rules", url: "/dashboard/automation", icon: Zap, isNew: true }],
  },
  {
    id: 3,
    labelKey: "support",
    items: [
      { titleKey: "tickets", url: "/dashboard/support/tickets", icon: MessageSquare, isNew: true },
      { titleKey: "slaManagement", url: "/dashboard/support/sla", icon: Clock, isNew: true },
    ],
  },
  {
    id: 4,
    labelKey: "marketing",
    items: [
      { titleKey: "templates", url: "/dashboard/marketing/templates", icon: Mail },
      { titleKey: "campaigns", url: "/dashboard/marketing/campaigns", icon: Target },
    ],
  },
  {
    id: 5,
    labelKey: "administration",
    items: [
      { titleKey: "users", url: "/dashboard/users", icon: Users, isNew: true },
      {
        titleKey: "reports",
        url: "/dashboard/reports",
        icon: BarChart3,
        isNew: true,
        subItems: [
          { titleKey: "reportBuilder", url: "/dashboard/reports/builder", icon: Wand2 },
        ],
      },
      {
        titleKey: "settings",
        url: "/dashboard/settings",
        icon: Settings,
        subItems: [
          { titleKey: "billing", url: "/dashboard/settings/billing", icon: CreditCard },
          { titleKey: "customFields", url: "/dashboard/settings/custom-fields", icon: Settings2 },
          { titleKey: "email", url: "/dashboard/settings/email", icon: MailOpen },
          { titleKey: "webhooks", url: "/dashboard/settings/webhooks", icon: Webhook },
        ],
      },
      { titleKey: "help", url: "/dashboard/help", icon: HelpCircle },
    ],
  },
];

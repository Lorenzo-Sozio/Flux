import {
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  ChartBar,
  CheckSquare,
  Clock,
  Contact,
  FileText,
  Fingerprint,
  Gauge,
  Kanban,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  MailOpen,
  MessageCircle,
  MessageSquare,
  Package,
  Settings,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Webhook,
  Zap,
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
      { titleKey: "pipeline", url: "/dashboard/pipeline", icon: Kanban },
      { titleKey: "calendar", url: "/dashboard/calendar", icon: Calendar },
      { titleKey: "tasks", url: "/dashboard/tasks", icon: CheckSquare },
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
      { titleKey: "finance", url: "/dashboard/finance", icon: Banknote },
      { titleKey: "quotes", url: "/dashboard/quotes", icon: FileText, isNew: true },
      { titleKey: "products", url: "/dashboard/products", icon: Package, isNew: true },
      { titleKey: "orders", url: "/dashboard/orders", icon: ShoppingCart, isNew: true },
    ],
  },
  {
    id: 2.5,
    labelKey: "automation",
    items: [
      { titleKey: "rules", url: "/dashboard/automation", icon: Zap, isNew: true },
    ],
  },
  {
    id: 3,
    labelKey: "support",
    items: [
      { titleKey: "tickets", url: "/dashboard/support/tickets", icon: MessageSquare, isNew: true },
      { titleKey: "slaManagement", url: "/dashboard/settings/sla", icon: Clock, isNew: true },
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
      { titleKey: "roles", url: "/dashboard/roles", icon: ShieldCheck },
      { titleKey: "reports", url: "/dashboard/reports", icon: BarChart3, isNew: true },
      {
        titleKey: "settings",
        url: "/dashboard/settings",
        icon: Settings,
        subItems: [
          { titleKey: "customFields", url: "/dashboard/settings/custom-fields", icon: Settings2 },
          { titleKey: "email", url: "/dashboard/settings/email", icon: MailOpen },
          { titleKey: "webhooks", url: "/dashboard/settings/webhooks", icon: Webhook },
        ],
      },
    ],
  },
  {
    id: 6,
    labelKey: "dashboardTemplates",
    items: [
      { titleKey: "analytics", url: "/dashboard/analytics", icon: Gauge },
      {
        titleKey: "authPages",
        url: "/auth",
        icon: Fingerprint,
        subItems: [
          { titleKey: "loginV1", url: "/auth/v1/login", newTab: true },
          { titleKey: "loginV2", url: "/auth/v2/login", newTab: true },
          { titleKey: "registerV1", url: "/auth/v1/register", newTab: true },
          { titleKey: "registerV2", url: "/auth/v2/register", newTab: true },
          { titleKey: "forgotPassword", url: "/auth/v1/forgot-password", newTab: true },
        ],
      },
    ],
  },
];

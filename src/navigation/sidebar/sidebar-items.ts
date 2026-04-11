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
  MessageSquare,
  Settings,
  Settings2,
  Target,
  TrendingUp,
  Users,
  Webhook,
  Zap,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "CRM",
    items: [
      {
        title: "Dashboard",
        url: "/dashboard/crm",
        icon: ChartBar,
      },
      {
        title: "Pipeline",
        url: "/dashboard/pipeline",
        icon: Kanban,
      },
      {
        title: "Calendar",
        url: "/dashboard/calendar",
        icon: Calendar,
      },
      {
        title: "Tasks",
        url: "/dashboard/tasks",
        icon: CheckSquare,
      },
      {
        title: "Leads",
        url: "/dashboard/leads",
        icon: Users,
      },
      {
        title: "Contacts",
        url: "/dashboard/contacts",
        icon: Contact,
      },
      {
        title: "Companies",
        url: "/dashboard/companies",
        icon: Building2,
      },
    ],
  },
  {
    id: 2,
    label: "Sales",
    items: [
      {
        title: "Quotes",
        url: "/dashboard/quotes",
        icon: FileText,
        isNew: true,
      },
    ],
  },
  {
    id: 2.5,
    label: "Automation",
    items: [
      {
        title: "Rules",
        url: "/dashboard/automation",
        icon: Zap,
        isNew: true,
      },
    ],
  },
  {
    id: 3,
    label: "Support",
    items: [
      {
        title: "Tickets",
        url: "/dashboard/support/tickets",
        icon: MessageSquare,
        isNew: true,
      },
      {
        title: "SLA Management",
        url: "/dashboard/settings/sla",
        icon: Clock,
        isNew: true,
      },
    ],
  },
  {
    id: 4,
    label: "Marketing",
    items: [
      {
        title: "Templates",
        url: "/dashboard/marketing/templates",
        icon: Mail,
      },
      {
        title: "Campaigns",
        url: "/dashboard/marketing/campaigns",
        icon: Target,
      },
    ],
  },
  {
    id: 5,
    label: "Administration",
    items: [
      {
        title: "Users",
        url: "/dashboard/users",
        icon: Users,
        isNew: true,
      },
      {
        title: "Reports",
        url: "/dashboard/reports",
        icon: BarChart3,
        isNew: true,
      },
      {
        title: "Settings",
        url: "/dashboard/settings",
        icon: Settings,
        subItems: [
          {
            title: "Custom Fields",
            url: "/dashboard/settings/custom-fields",
            icon: Settings2,
          },
          {
            title: "Email",
            url: "/dashboard/settings/email",
            icon: MailOpen,
          },
          {
            title: "Webhooks",
            url: "/dashboard/settings/webhooks",
            icon: Webhook,
          },
        ],
      },
    ],
  },
  {
    id: 6,
    label: "Dashboard Templates",
    items: [
      {
        title: "Finance",
        url: "/dashboard/finance",
        icon: Banknote,
      },
      {
        title: "Analytics",
        url: "/dashboard/analytics",
        icon: Gauge,
      },
      {
        title: "Auth Pages",
        url: "/auth",
        icon: Fingerprint,
        subItems: [
          { title: "Login v1", url: "/auth/v1/login", newTab: true },
          { title: "Login v2", url: "/auth/v2/login", newTab: true },
          { title: "Register v1", url: "/auth/v1/register", newTab: true },
          { title: "Register v2", url: "/auth/v2/register", newTab: true },
          { title: "Forgot Password", url: "/auth/v1/forgot-password", newTab: true },
        ],
      },
    ],
  },
];

import {
  Banknote,
  Building2,
  Calendar,
  ChartBar,
  Contact,
  Fingerprint,
  Forklift,
  Gauge,
  GraduationCap,
  Kanban,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  Mail,
  MessageSquare,
  ReceiptText,
  ShoppingBag,
  SquareArrowUpRight,
  Users,
  Target,
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
    label: "Dashboards",
    items: [
      {
        title: "CRM",
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
    label: "Templates",
    items: [
    {
        title: "Templates - 1",
        url: "/dashboard/default",
        icon: LayoutDashboard,
      },
      {
        title: "Templates - Finance",
        url: "/dashboard/finance",
        icon: Banknote,
      },
      {
        title: "Templates -Analytics",
        url: "/dashboard/analytics",
        icon: Gauge,
      },
      {
        title: "Authentication",
        url: "/auth",
        icon: Fingerprint,
        subItems: [
          { title: "Login v1", url: "/auth/v1/login", newTab: true },
          { title: "Login v2", url: "/auth/v2/login", newTab: true },
          { title: "Register v1", url: "/auth/v1/register", newTab: true },
          { title: "Register v2", url: "/auth/v2/register", newTab: true },
        ],
      },
    ],
  },
  {
    id: 3,
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
    id: 4,
    label: "Pages Soon",
    items: [
      {
        title: "Email",
        url: "/dashboard/coming-soon",
        icon: Mail,
        comingSoon: true,
      },
      {
        title: "Chat",
        url: "/dashboard/coming-soon",
        icon: MessageSquare,
        comingSoon: true,
      },
      {
        title: "Kanban",
        url: "/dashboard/coming-soon",
        icon: Kanban,
        comingSoon: true,
      },
      {
        title: "Invoice",
        url: "/dashboard/coming-soon",
        icon: ReceiptText,
        comingSoon: true,
      },
      {
        title: "Users",
        url: "/dashboard/coming-soon",
        icon: Users,
        comingSoon: true,
      },
      {
        title: "Roles",
        url: "/dashboard/coming-soon",
        icon: Lock,
        comingSoon: true,
      },
    ],
  },
  {
    id: 5,
    label: "Misc",
    items: [
      {
        title: "Others",
        url: "/dashboard/coming-soon",
        icon: SquareArrowUpRight,
        comingSoon: true,
      },
    ],
  },
];

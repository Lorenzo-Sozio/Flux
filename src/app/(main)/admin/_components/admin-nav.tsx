"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Building2, CreditCard, HelpCircle, Settings2 } from "lucide-react";

const NAV_ITEMS = [
  {
    label: "Tenants",
    href: "/admin/tenants",
    icon: Building2,
    match: (p: string) => p.startsWith("/admin/tenants"),
  },
  {
    label: "Billing",
    href: "/admin/billing",
    icon: CreditCard,
    match: (p: string) => p.startsWith("/admin/billing"),
  },
  {
    label: "Plans",
    href: "/admin/plans",
    icon: Settings2,
    match: (p: string) => p.startsWith("/admin/plans"),
  },
  {
    label: "Help",
    href: "/admin/help",
    icon: HelpCircle,
    match: (p: string) => p.startsWith("/admin/help"),
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
      {NAV_ITEMS.map(({ label, href, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

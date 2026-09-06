import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LogOut } from "lucide-react";

import { adminLogout } from "@/actions/admin-auth";
import { getAdminSession } from "@/lib/admin-session";

import { AdminNav } from "./_components/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  const isLoginPage = pathname === "/admin/login";

  const adminSession = await getAdminSession();
  const isAuthenticated = adminSession?.role === "admin" || adminSession?.role === "owner";

  // Login page: redirect away if already authenticated; otherwise render without chrome
  if (isLoginPage) {
    if (isAuthenticated) redirect("/admin/tenants");
    return <>{children}</>;
  }

  // All other /admin/* routes require a valid admin session
  if (!isAuthenticated) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-dvh bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="font-bold text-3xl text-gray-900">Administration</h1>
            <p className="mt-1 text-gray-600 text-sm">Manage platform settings and tenants</p>
          </div>
          <form action={adminLogout}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-600 text-xs shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
              <LogOut className="h-3.5 w-3.5" />
              Esci dal pannello
            </button>
          </form>
        </div>
        <div className="mb-6">
          <AdminNav />
        </div>
        {children}
      </div>
    </div>
  );
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { adminLogout } from "@/actions/admin-auth";
import { getAdminSession } from "@/lib/admin-session";
import { AdminNav } from "./_components/admin-nav";
import { LogOut } from "lucide-react";

function isAdminRole(role: string | undefined): boolean {
  return role === "admin" || role === "owner";
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  const isLoginPage = pathname === "/admin/login";

  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session?.user) redirect("/login");
  if (!isAdminRole(role)) redirect("/unauthorized");

  // /admin/login: only needs NextAuth session + role (no admin cookie yet).
  // Render without admin chrome so the page controls its own full-screen layout.
  if (isLoginPage) {
    const adminSession = await getAdminSession();
    if (adminSession?.userId === session.user.id) redirect("/admin/tenants");
    return <>{children}</>;
  }

  // All other /admin/* routes: require a valid admin session cookie
  const adminSession = await getAdminSession();
  if (!adminSession || adminSession.userId !== session.user.id) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Administration</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage platform settings and tenants
            </p>
          </div>
          <form action={adminLogout}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors"
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

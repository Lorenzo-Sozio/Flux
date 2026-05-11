import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Admin layout
 * Ensures only admins/owners can access /admin routes.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session?.user || !["admin", "owner"].includes(role)) {
    redirect("/unauthorized");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Administration</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage platform settings and tenants
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

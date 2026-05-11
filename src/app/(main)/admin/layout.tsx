import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AdminNav } from "./_components/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session?.user) {
    redirect("/login");
  }

  if (!["admin", "owner"].includes(role)) {
    redirect("/unauthorized");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Administration</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage platform settings and tenants
          </p>
        </div>
        <div className="mb-6">
          <AdminNav />
        </div>
        {children}
      </div>
    </div>
  );
}

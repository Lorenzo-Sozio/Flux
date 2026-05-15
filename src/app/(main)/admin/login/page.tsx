import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { platformDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminSession } from "@/lib/admin-session";
import { AdminLoginForm } from "./_components/admin-login-form";

export const metadata = { title: "Flux CRM — Pannello Admin" };

export default async function AdminLoginPage() {
  const session = await auth();

  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "owner") redirect("/unauthorized");

  const adminSession = await getAdminSession();
  if (adminSession?.userId === session.user.id) redirect("/admin/tenants");

  // Determine if the user has a password set (needed to choose the auth flow)
  const [user] = await platformDb
    .select({ password: users.password })
    .from(users)
    .where(eq(users.id, session.user.id as string));

  const hasPassword = !!user?.password;
  const displayName = session.user.name ?? session.user.email ?? "Amministratore";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          {/* Flux Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg">
            <svg
              className="w-8 h-8 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" />
              <path d="M16 12c0 2.2-1.8 4-4 4s-4-1.8-4-4" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <path d="M4 12c2.2 0 4 1.8 4 4s-1.8 4-4 4-4-1.8-4-4" />
              <path d="M20 12c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-400 dark:to-blue-500 bg-clip-text text-transparent">
            Flux CRM
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-3 text-sm">
            Verifica la tua identità per accedere al pannello admin
          </p>
        </div>

        <AdminLoginForm displayName={displayName} hasPassword={hasPassword} />
      </div>
    </div>
  );
}

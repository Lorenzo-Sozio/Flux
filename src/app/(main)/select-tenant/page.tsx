import { redirect } from "next/navigation";

import { getTenantMembershipsAction } from "@/actions/auth";
import { auth } from "@/auth";

import { TenantSwitcher } from "./_components/tenant-switcher";

export default async function SelectTenantPage() {
  const session = await auth();

  if (!session?.user?.id) redirect("/auth/v1/login");

  // If the user already has an active tenant in the JWT, skip this page
  if (session.user.activeTenantId) redirect("/dashboard/crm");

  const memberships = await getTenantMembershipsAction();

  if (memberships.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-3xl">
            🔒
          </div>
          <h1 className="font-semibold text-slate-900 text-xl">No workspaces found</h1>
          <p className="mt-2 text-slate-500 text-sm">
            You are not a member of any workspace. Contact an administrator to receive an invitation.
          </p>
        </div>
      </div>
    );
  }

  return <TenantSwitcher memberships={memberships} />;
}

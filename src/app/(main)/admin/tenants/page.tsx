import type { Metadata } from "next";

import { listPlans } from "@/actions/admin-billing";
import { listTenants } from "@/actions/tenants";

import { CreateTenantForm } from "./_components/create-tenant-form";
import { TenantsList } from "./_components/tenants-list";

export const metadata: Metadata = {
  title: "Tenant Management",
  description: "Manage tenants on the platform",
};

export default async function TenantsPage() {
  const [allTenants, plans] = await Promise.all([listTenants(), listPlans()]);

  return (
    <div className="space-y-8">
      {/* Create Tenant Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-6 font-semibold text-gray-900 text-xl">Create New Tenant</h2>
        <CreateTenantForm />
      </div>

      {/* Tenants List Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-6 font-semibold text-gray-900 text-xl">Existing Tenants ({allTenants.length})</h2>
        <TenantsList tenants={allTenants} plans={plans} />
      </div>
    </div>
  );
}

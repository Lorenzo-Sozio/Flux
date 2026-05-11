import { Metadata } from "next";
import { listTenants } from "@/actions/tenants";
import { listPlans } from "@/actions/admin-billing";
import { TenantsList } from "./_components/tenants-list";
import { CreateTenantForm } from "./_components/create-tenant-form";

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
        <h2 className="mb-6 text-xl font-semibold text-gray-900">
          Create New Tenant
        </h2>
        <CreateTenantForm />
      </div>

      {/* Tenants List Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-xl font-semibold text-gray-900">
          Existing Tenants ({allTenants.length})
        </h2>
        <TenantsList tenants={allTenants} plans={plans} />
      </div>
    </div>
  );
}

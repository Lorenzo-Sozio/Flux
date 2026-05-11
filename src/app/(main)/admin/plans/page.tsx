import { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listPlans } from "@/actions/admin-billing";
import { PlansClient } from "./_components/plans-client";

export const metadata: Metadata = { title: "Plan Management" };

export default async function PlansPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/v1/login");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "owner") redirect("/admin/tenants");

  const plans = await listPlans();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
        <p className="text-muted-foreground">
          Create and configure subscription plans. Map them to Stripe Price IDs before publishing.
        </p>
      </div>
      <PlansClient plans={plans} />
    </div>
  );
}

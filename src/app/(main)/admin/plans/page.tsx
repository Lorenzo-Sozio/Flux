import type { Metadata } from "next";

import { listPlans } from "@/actions/admin-billing";

import { PlansClient } from "./_components/plans-client";

export const metadata: Metadata = { title: "Plan Management" };

export default async function PlansPage() {
  const plans = await listPlans();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Plans</h1>
        <p className="text-muted-foreground">
          Create and configure subscription plans. Map them to Stripe Price IDs before publishing.
        </p>
      </div>
      <PlansClient plans={plans} />
    </div>
  );
}

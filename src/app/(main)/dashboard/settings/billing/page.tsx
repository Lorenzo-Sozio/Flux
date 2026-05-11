import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getSubscriptionDetails, getPublicPlans, getInvoices } from "@/actions/billing";
import { BillingClient } from "./_components/billing-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Billing & Subscription",
};

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/v1/login");

  const role = (session.user as { role?: string }).role;
  if (!role || !["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  const [details, plans, invoices] = await Promise.all([
    getSubscriptionDetails().catch(() => null),
    getPublicPlans().catch(() => []),
    getInvoices().catch(() => []),
  ]);

  const entitlements = details?.entitlements;
  const subscription = details?.subscription;
  const addons = details?.addons ?? [];
  const usage = details?.usage ?? {};

  if (!entitlements) redirect("/dashboard/crm");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing &amp; Subscription</h1>
        <p className="text-muted-foreground">
          Manage your plan, add-ons, and invoices.
        </p>
      </div>

      <BillingClient
        entitlements={entitlements}
        subscription={
          subscription
            ? {
                status: subscription.status,
                billingCycle: subscription.billingCycle,
                currentPeriodEnd: subscription.currentPeriodEnd,
              }
            : null
        }
        plans={plans}
        addons={addons.map((a) => ({
          id: a.id,
          addonType: a.addonType,
          quantity: a.quantity,
          status: a.status,
        }))}
        invoices={invoices.map((inv) => ({
          ...inv,
          hostedInvoiceUrl: inv.hostedInvoiceUrl ?? null,
          invoicePdf: inv.invoicePdf ?? null,
        }))}
        usage={usage}
      />
    </div>
  );
}

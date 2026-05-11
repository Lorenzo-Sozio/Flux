import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { getInvoices, getPublicPlans, getSubscriptionDetails } from "@/actions/billing";
import { auth } from "@/auth";

import { BillingClient } from "./_components/billing-client";

export const metadata: Metadata = {
  title: "Billing & Subscription",
};

const MODULE_NAMES: Record<string, string> = {
  marketing: "Marketing",
  automation: "Automation",
  support: "Support Tickets",
  reporting: "Advanced Reports",
  sales: "Sales & Pipeline",
  helpdesk: "Helpdesk",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ upgrade?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/v1/login");

  const role = (session.user as { role?: string }).role;
  if (!role || !["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  const { upgrade } = await searchParams;

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

  const upgradeModuleName = upgrade ? (MODULE_NAMES[upgrade] ?? upgrade) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing &amp; Subscription</h1>
        <p className="text-muted-foreground">Manage your plan, add-ons, and invoices.</p>
      </div>

      {upgradeModuleName && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <strong>{upgradeModuleName}</strong> is not included in your current plan. Upgrade below to unlock it.
        </div>
      )}

      <BillingClient
        entitlements={entitlements}
        defaultTab={upgrade ? "plans" : "overview"}
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

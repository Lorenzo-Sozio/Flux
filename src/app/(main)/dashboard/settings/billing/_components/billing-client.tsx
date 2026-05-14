"use client";

import { useTransition } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createBillingPortalSession } from "@/actions/billing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TenantEntitlements } from "@/lib/billing/licensing";

import { AddonManager } from "./addon-manager";
import { CurrentPlan } from "./current-plan";
import { InvoiceList } from "./invoice-list";
import { PlanSelector } from "./plan-selector";
import { UsageOverview } from "./usage-overview";

interface BillingClientProps {
  entitlements: TenantEntitlements;
  subscription: {
    status: string;
    billingCycle: string;
    currentPeriodEnd: Date | null;
  } | null;
  plans: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string | null;
    pricePerUserMonthly: number;
    pricePerUserAnnual: number;
    annualDiscountPercent: number;
    includedUsers: number;
    maxUsers: number | null;
    trialDays: number;
    enabledModules: string;
    stripePriceMonthlyId: string | null;
    stripePriceAnnualId: string | null;
    sortOrder: number;
  }>;
  addons: Array<{ id: string; addonType: string; quantity: number; status: string }>;
  invoices: Array<{
    id: string;
    number: string | null;
    status: string | null;
    amountDue: number;
    amountPaid: number;
    currency: string;
    periodStart: number;
    periodEnd: number;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
    created: number;
  }>;
  usage: Record<string, { current: number; limit: number | null; percent: number | null }>;
  defaultTab?: "overview" | "plans";
}

export function BillingClient({
  entitlements,
  subscription,
  plans,
  addons,
  invoices,
  usage,
  defaultTab = "overview",
}: BillingClientProps) {
  const t = useTranslations("settings.billing");
  const [portalLoading, startPortal] = useTransition();

  function handleManageBilling() {
    startPortal(async () => {
      try {
        const { url } = await createBillingPortalSession();
        window.location.href = url;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("portalError"));
      }
    });
  }

  return (
    <Tabs defaultValue={defaultTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
        <TabsTrigger value="plans">{t("tabs.plans")}</TabsTrigger>
        <TabsTrigger value="addons">{t("tabs.addons")}</TabsTrigger>
        <TabsTrigger value="invoices">{t("tabs.invoices")}</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <CurrentPlan
          entitlements={entitlements}
          periodEnd={subscription?.currentPeriodEnd}
          billingCycle={subscription?.billingCycle}
          onManageClick={handleManageBilling}
          loading={portalLoading}
        />
        <UsageOverview usage={usage} limits={entitlements.limits} />
      </TabsContent>

      <TabsContent value="plans" className="space-y-4">
        <PlanSelector plans={plans} currentPlanName={entitlements.planName} />
      </TabsContent>

      <TabsContent value="addons" className="space-y-4">
        <AddonManager addons={addons} />
      </TabsContent>

      <TabsContent value="invoices" className="space-y-4">
        <InvoiceList invoices={invoices} />
      </TabsContent>
    </Tabs>
  );
}

"use client";

import { useState } from "react";

import { Check, CheckCircle2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createCheckoutSession } from "@/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { BillingCycle } from "@/lib/billing/plans-config";

interface Plan {
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
  enabledModules: string; // JSON
  stripePriceMonthlyId: string | null;
  stripePriceAnnualId: string | null;
  sortOrder: number;
}

interface PlanSelectorProps {
  plans: Plan[];
  currentPlanName: string;
}

export function PlanSelector({ plans, currentPlanName }: PlanSelectorProps) {
  const t = useTranslations("settings.billing");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState<string | null>(null);
  const currentSortOrder = plans.find((p) => p.name === currentPlanName)?.sortOrder ?? 0;

  async function handleSelectPlan(plan: Plan, userCount: number) {
    if (plan.name === currentPlanName) return;
    setLoading(plan.id);
    try {
      const { url } = await createCheckoutSession(plan.id, cycle, userCount);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("plans.checkoutError"));
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2">
        <span
          className={`cursor-pointer text-sm ${cycle === "monthly" ? "font-semibold" : "text-muted-foreground"}`}
          onClick={() => setCycle("monthly")}
        >
          {t("plans.monthly")}
        </span>
        <button
          type="button"
          onClick={() => setCycle(cycle === "monthly" ? "annual" : "monthly")}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            cycle === "annual" ? "bg-primary" : "bg-muted"
          }`}
          aria-label={t("plans.toggleCycleLabel")}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              cycle === "annual" ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span
          className={`cursor-pointer text-sm ${cycle === "annual" ? "font-semibold" : "text-muted-foreground"}`}
          onClick={() => setCycle("annual")}
        >
          {t("plans.annual")}
          {plans[1]?.annualDiscountPercent > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {t("plans.save", { percent: plans[1].annualDiscountPercent })}
            </Badge>
          )}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const price = cycle === "annual" ? plan.pricePerUserAnnual : plan.pricePerUserMonthly;
          const modules: string[] = JSON.parse(plan.enabledModules ?? '["crm"]');
          const isCurrent = plan.name === currentPlanName;
          const isClickable = !isCurrent && plan.name !== "free" && !loading;

          return (
            <Card
              key={plan.id}
              onClick={() => isClickable && handleSelectPlan(plan, plan.includedUsers)}
              className={`flex flex-col transition-all ${
                isCurrent
                  ? "border-green-500 bg-green-50/50 ring-2 ring-green-500 dark:bg-green-950/20"
                  : plan.name === "professional" && isClickable
                    ? "cursor-pointer border-primary ring-1 ring-primary hover:shadow-md hover:ring-2"
                    : isClickable
                      ? "cursor-pointer hover:border-primary/40 hover:shadow-md"
                      : ""
              }`}
            >
              <CardHeader className="pb-2">
                {isCurrent && (
                  <Badge
                    variant="outline"
                    className="mb-1 w-fit text-xs border-green-500 text-green-600 dark:text-green-400"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    {t("plans.currentPlan")}
                  </Badge>
                )}
                {!isCurrent && plan.name === "professional" && (
                  <Badge className="mb-1 w-fit text-xs">{t("plans.mostPopular")}</Badge>
                )}
                <CardTitle className="text-lg">{plan.displayName}</CardTitle>
                <CardDescription className="min-h-[2.5rem] text-xs">{plan.description}</CardDescription>
                <div className="mt-2">
                  <span className="text-3xl font-bold">
                    {price === 0 ? t("plans.freePrice") : `€${(price / 100).toFixed(0)}`}
                  </span>
                  {price > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {t("plans.perUserPerMonth")}
                      {cycle === "annual" ? ` ${t("plans.billedAnnually")}` : ""}
                    </span>
                  )}
                </div>
                {plan.includedUsers > 0 && price > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("plans.includesUsers", { count: plan.includedUsers })}
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-1.5">
                  {modules.map((mod) => (
                    <li key={mod} className="flex items-center gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                      {t(`plans.modules.${mod}` as Parameters<typeof t>[0], { fallback: mod })}
                    </li>
                  ))}
                </ul>
                {plan.trialDays > 0 && !isCurrent && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t("plans.trialDays", { count: plan.trialDays })}
                  </p>
                )}
              </CardContent>

              <CardFooter>
                {isCurrent ? (
                  <Button
                    className="w-full border-green-500 text-green-600 dark:text-green-400"
                    disabled
                    variant="outline"
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {t("plans.currentPlan")}
                  </Button>
                ) : plan.name === "free" ? (
                  <Button className="w-full" variant="outline" disabled>
                    {t("plans.freeForever")}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={plan.sortOrder < currentSortOrder ? "outline" : "default"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectPlan(plan, plan.includedUsers);
                    }}
                    disabled={!!loading}
                  >
                    {loading === plan.id ? (
                      t("plans.redirecting")
                    ) : plan.sortOrder > currentSortOrder ? (
                      <>
                        <Zap className="mr-2 h-4 w-4" />
                        {t("plans.upgrade")}
                      </>
                    ) : (
                      t("plans.downgrade")
                    )}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

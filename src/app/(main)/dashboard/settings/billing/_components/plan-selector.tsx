"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Zap } from "lucide-react";
import { toast } from "sonner";
import { createCheckoutSession } from "@/actions/billing";
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
}

interface PlanSelectorProps {
  plans: Plan[];
  currentPlanName: string;
}

const MODULE_LABELS: Record<string, string> = {
  crm: "CRM",
  sales: "Sales & Pipeline",
  marketing: "Marketing",
  support: "Support Tickets",
  automation: "Automation",
  reporting: "Advanced Reports",
  helpdesk: "Helpdesk",
};

function formatPrice(cents: number) {
  if (cents === 0) return "Free";
  return `€${(cents / 100).toFixed(0)}`;
}

export function PlanSelector({ plans, currentPlanName }: PlanSelectorProps) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState<string | null>(null);

  async function handleSelectPlan(plan: Plan, userCount: number) {
    if (plan.name === currentPlanName) return;
    setLoading(plan.id);
    try {
      const { url } = await createCheckoutSession(plan.id, cycle, userCount);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start checkout");
      setLoading(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center gap-2">
        <span
          className={`cursor-pointer text-sm ${cycle === "monthly" ? "font-semibold" : "text-muted-foreground"}`}
          onClick={() => setCycle("monthly")}
        >
          Monthly
        </span>
        <button
          type="button"
          onClick={() => setCycle(cycle === "monthly" ? "annual" : "monthly")}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            cycle === "annual" ? "bg-primary" : "bg-muted"
          }`}
          aria-label="Toggle billing cycle"
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
          Annual
          {plans[1]?.annualDiscountPercent > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              Save {plans[1].annualDiscountPercent}%
            </Badge>
          )}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const price =
            cycle === "annual" ? plan.pricePerUserAnnual : plan.pricePerUserMonthly;
          const modules: string[] = JSON.parse(plan.enabledModules ?? '["crm"]');
          const isCurrent = plan.name === currentPlanName;
          const hasStripePrice = cycle === "annual"
            ? !!plan.stripePriceAnnualId
            : !!plan.stripePriceMonthlyId;

          return (
            <Card
              key={plan.id}
              className={`flex flex-col ${
                plan.name === "professional" ? "border-primary ring-1 ring-primary" : ""
              } ${isCurrent ? "opacity-70" : ""}`}
            >
              <CardHeader className="pb-2">
                {plan.name === "professional" && (
                  <Badge className="mb-1 w-fit text-xs">Most Popular</Badge>
                )}
                <CardTitle className="text-lg">{plan.displayName}</CardTitle>
                <CardDescription className="min-h-[2.5rem] text-xs">
                  {plan.description}
                </CardDescription>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{formatPrice(price)}</span>
                  {price > 0 && (
                    <span className="text-sm text-muted-foreground">
                      /user/mo{cycle === "annual" ? " (billed annually)" : ""}
                    </span>
                  )}
                </div>
                {plan.includedUsers > 0 && price > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Includes {plan.includedUsers} user{plan.includedUsers > 1 ? "s" : ""}
                  </p>
                )}
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-1.5">
                  {modules.map((mod) => (
                    <li key={mod} className="flex items-center gap-2 text-sm">
                      <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                      {MODULE_LABELS[mod] ?? mod}
                    </li>
                  ))}
                </ul>
                {plan.trialDays > 0 && !isCurrent && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {plan.trialDays}-day free trial
                  </p>
                )}
              </CardContent>

              <CardFooter>
                {isCurrent ? (
                  <Button className="w-full" disabled variant="outline">
                    Current Plan
                  </Button>
                ) : plan.name === "free" ? (
                  <Button className="w-full" variant="outline" disabled>
                    Free Forever
                  </Button>
                ) : !hasStripePrice ? (
                  <Button className="w-full" variant="outline" disabled>
                    Contact Sales
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => handleSelectPlan(plan, plan.includedUsers)}
                    disabled={loading === plan.id}
                  >
                    {loading === plan.id ? (
                      "Redirecting…"
                    ) : (
                      <>
                        <Zap className="mr-2 h-4 w-4" />
                        Upgrade
                      </>
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

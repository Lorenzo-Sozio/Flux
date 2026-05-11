"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CreditCard, ExternalLink, Zap } from "lucide-react";
import type { TenantEntitlements } from "@/lib/billing/licensing";

interface CurrentPlanProps {
  entitlements: TenantEntitlements;
  periodEnd?: Date | null;
  billingCycle?: string;
  onManageClick: () => void;
  loading?: boolean;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  trialing: { label: "Trial", variant: "secondary" },
  free: { label: "Free", variant: "outline" },
  past_due: { label: "Past Due", variant: "destructive" },
  suspended: { label: "Suspended", variant: "destructive" },
  canceled: { label: "Canceled", variant: "destructive" },
};

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export function CurrentPlan({
  entitlements,
  periodEnd,
  billingCycle,
  onManageClick,
  loading,
}: CurrentPlanProps) {
  const badge = STATUS_BADGE[entitlements.status] ?? STATUS_BADGE.free;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {entitlements.planName.charAt(0).toUpperCase() + entitlements.planName.slice(1)} Plan
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </CardTitle>
          <CardDescription>
            {billingCycle === "annual" ? "Annual billing" : "Monthly billing"}
            {periodEnd && (
              <>
                {" "}
                · Renews{" "}
                {new Date(periodEnd).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </>
            )}
          </CardDescription>
        </div>
        {entitlements.status !== "free" && (
          <Button variant="outline" size="sm" onClick={onManageClick} disabled={loading}>
            <CreditCard className="mr-2 h-4 w-4" />
            Manage Billing
            <ExternalLink className="ml-2 h-3 w-3 opacity-60" />
          </Button>
        )}
      </CardHeader>

      <CardContent>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Stat
            label="Max Users"
            value={entitlements.maxUsers === null ? "Unlimited" : String(entitlements.maxUsers)}
          />
          <Stat label="Support" value={capitalize(entitlements.supportTier)} />
          <Stat
            label="Modules"
            value={`${entitlements.enabledModules.length} enabled`}
          />
          <Stat
            label="Storage"
            value={`${entitlements.limits.storageGb ?? 1} GB`}
          />
          <Stat
            label="API Calls / mo"
            value={
              entitlements.limits.apiCallsPerMonth === null
                ? "Unlimited"
                : formatNumber(entitlements.limits.apiCallsPerMonth)
            }
          />
          <Stat
            label="Automations / mo"
            value={
              entitlements.limits.automationRunsPerMonth === null
                ? "Unlimited"
                : formatNumber(entitlements.limits.automationRunsPerMonth)
            }
          />
        </div>

        {entitlements.status === "past_due" && (
          <div className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Your payment is overdue. Please update your payment method to restore full access.
          </div>
        )}
        {entitlements.status === "suspended" && (
          <div className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Your account is suspended. Please contact support to reactivate.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en").format(n);
}

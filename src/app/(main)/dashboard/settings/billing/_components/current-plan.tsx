"use client";

import { CreditCard, ExternalLink, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { TenantEntitlements } from "@/lib/billing/licensing";

interface CurrentPlanProps {
  entitlements: TenantEntitlements;
  periodEnd?: Date | null;
  billingCycle?: string;
  onManageClick: () => void;
  loading?: boolean;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trialing: "secondary",
  free: "outline",
  past_due: "destructive",
  suspended: "destructive",
  canceled: "destructive",
};

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

export function CurrentPlan({ entitlements, periodEnd, billingCycle, onManageClick, loading }: CurrentPlanProps) {
  const t = useTranslations("settings.billing");
  const tPlan = useTranslations("settings.billing.currentPlanCard");
  const format = useFormatter();

  const statusKey = entitlements.status in STATUS_VARIANT ? entitlements.status : "free";
  const statusVariant = STATUS_VARIANT[statusKey] ?? "outline";
  const statusLabel = t(`currentPlan.status.${statusKey}` as Parameters<typeof t>[0]);

  return (
    <Card>
      {/* ⚠️ A plan name, a status badge and a button that says "Manage billing"
          and carries two icons is 480px of row. It did not wrap, so the plan
          name broke onto two lines and the button was cut off at the card's
          edge — the one control on this card. */}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {tPlan("planName", {
              name: entitlements.planName.charAt(0).toUpperCase() + entitlements.planName.slice(1),
            })}
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </CardTitle>
          <CardDescription>
            {billingCycle === "annual" ? t("currentPlan.annualBilling") : t("currentPlan.monthlyBilling")}
            {periodEnd && (
              <>
                {" "}
                · {t("currentPlan.renews")}{" "}
                {format.dateTime(new Date(periodEnd), {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </>
            )}
          </CardDescription>
        </div>
        {entitlements.status !== "free" && (
          <Button variant="outline" size="sm" onClick={onManageClick} disabled={loading} className="shrink-0">
            <CreditCard className="mr-2 h-4 w-4" />
            {t("currentPlan.manageBilling")}
            <ExternalLink className="ml-2 h-3 w-3 opacity-60" />
          </Button>
        )}
      </CardHeader>

      <CardContent>
        <Separator className="mb-4" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Stat
            label={t("currentPlan.statMaxUsers")}
            value={entitlements.maxUsers === null ? t("currentPlan.status.free") : String(entitlements.maxUsers)}
          />
          <Stat
            label={t("currentPlan.statSupport")}
            value={
              tPlan.has(`supportTiers.${entitlements.supportTier}`)
                ? tPlan(`supportTiers.${entitlements.supportTier}`)
                : capitalize(entitlements.supportTier)
            }
          />
          <Stat
            label={t("currentPlan.statModules")}
            value={t("currentPlan.modulesEnabled", { count: entitlements.enabledModules.length })}
          />
          <Stat label={t("currentPlan.statStorage")} value={`${entitlements.limits.storageGb ?? 1} GB`} />
          <Stat
            label={t("currentPlan.statApiCalls")}
            value={
              entitlements.limits.apiCallsPerMonth === null
                ? t("usage.unlimited")
                : format.number(entitlements.limits.apiCallsPerMonth)
            }
          />
          <Stat
            label={t("currentPlan.statAutomations")}
            value={
              entitlements.limits.automationRunsPerMonth === null
                ? t("usage.unlimited")
                : format.number(entitlements.limits.automationRunsPerMonth)
            }
          />
        </div>

        {entitlements.status === "past_due" && (
          <div className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t("currentPlan.pastDueWarning")}
          </div>
        )}
        {entitlements.status === "suspended" && (
          <div className="mt-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {t("currentPlan.suspendedWarning")}
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

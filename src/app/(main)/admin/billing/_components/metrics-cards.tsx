"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, DollarSign, AlertCircle } from "lucide-react";

interface MetricsCardsProps {
  mrr: number;
  arr: number;
  arpu: number;
  churnRate: number;
  activeCount: number;
  trialCount: number;
  pastDueCount: number;
  suspendedCount: number;
  totalTenants: number;
}

function formatEur(cents: number) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function MetricsCards({
  mrr,
  arr,
  arpu,
  churnRate,
  activeCount,
  trialCount,
  pastDueCount,
  suspendedCount,
  totalTenants,
}: MetricsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">MRR</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatEur(mrr)}</p>
          <p className="text-xs text-muted-foreground">Monthly Recurring Revenue</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">ARR</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatEur(arr)}</p>
          <p className="text-xs text-muted-foreground">Annual Recurring Revenue</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">ARPU</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatEur(arpu)}</p>
          <p className="text-xs text-muted-foreground">Avg Revenue Per Account</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Churn</CardTitle>
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{churnRate}%</p>
          <p className="text-xs text-muted-foreground">Cumulative churn rate</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Tenants Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="font-semibold text-green-600">{activeCount}</span>
            <span className="ml-1 text-muted-foreground">Active</span>
          </div>
          <div>
            <span className="font-semibold text-yellow-600">{trialCount}</span>
            <span className="ml-1 text-muted-foreground">Trial</span>
          </div>
          <div>
            <span className="font-semibold text-orange-500">{pastDueCount}</span>
            <span className="ml-1 text-muted-foreground">Past Due</span>
          </div>
          <div>
            <span className="font-semibold text-destructive">{suspendedCount}</span>
            <span className="ml-1 text-muted-foreground">Suspended</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAdminMetrics, listSubscriptions } from "@/actions/admin-billing";
import { MetricsCards } from "./_components/metrics-cards";
import { SubscriptionsTable } from "./_components/subscriptions-table";
import { Settings2, AlertCircle } from "lucide-react";

export const metadata: Metadata = { title: "Billing Admin" };

const EMPTY_METRICS = {
  mrr: 0, arr: 0, arpu: 0, churnRate: 0,
  activeCount: 0, trialCount: 0, pastDueCount: 0,
  suspendedCount: 0, canceledCount: 0, totalTenants: 0, perPlan: {},
};

export default async function AdminBillingPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/v1/login");
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "owner") redirect("/admin/tenants");

  let metrics = EMPTY_METRICS;
  let subscriptions: Awaited<ReturnType<typeof listSubscriptions>> = [];
  let dbError: string | null = null;

  try {
    [metrics, subscriptions] = await Promise.all([
      getAdminMetrics(),
      listSubscriptions(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Dashboard</h1>
          <p className="text-muted-foreground">
            Platform-wide subscription metrics and tenant management.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/plans">
            <Settings2 className="mr-2 h-4 w-4" />
            Manage Plans
          </Link>
        </Button>
      </div>

      {dbError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Billing tables not found</AlertTitle>
          <AlertDescription>
            Run <code className="font-mono text-xs">npx drizzle-kit push</code> to apply the
            billing migration, then reload this page.
            <span className="ml-2 text-xs opacity-70">({dbError})</span>
          </AlertDescription>
        </Alert>
      )}

      <MetricsCards
        mrr={metrics.mrr}
        arr={metrics.arr}
        arpu={metrics.arpu}
        churnRate={metrics.churnRate}
        activeCount={metrics.activeCount}
        trialCount={metrics.trialCount}
        pastDueCount={metrics.pastDueCount}
        suspendedCount={metrics.suspendedCount}
        totalTenants={metrics.totalTenants}
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({subscriptions.length})</TabsTrigger>
          <TabsTrigger value="active">Active ({metrics.activeCount})</TabsTrigger>
          <TabsTrigger value="issues">
            Issues ({metrics.pastDueCount + metrics.suspendedCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <SubscriptionsTable
            subscriptions={subscriptions}
            currentUserId={session.user.id!}
          />
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <SubscriptionsTable
            subscriptions={subscriptions.filter((s) =>
              ["active", "trialing"].includes(s.subscription.status),
            )}
            currentUserId={session.user.id!}
          />
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <SubscriptionsTable
            subscriptions={subscriptions.filter((s) =>
              ["past_due", "suspended"].includes(s.subscription.status),
            )}
            currentUserId={session.user.id!}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteTenant, migrateAllTenants, migrateTenantDb } from "@/actions/tenants";
import { adminSetTenantPlan } from "@/actions/admin-billing";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  Trash2,
  Copy,
  CheckCircle2,
  DatabaseZap,
  Users,
  Pencil,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  settings: string | null;
  createdAt: Date;
  updatedAt: Date;
  subscriptionStatus: string | null;
  planId: string | null;
  planName: string | null;
  planDisplayName: string | null;
}

interface Plan {
  id: string;
  name: string;
  displayName: string;
  isActive: boolean;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active:    { label: "Active",    className: "bg-green-100 text-green-700" },
  trialing:  { label: "Trial",     className: "bg-blue-100 text-blue-700" },
  past_due:  { label: "Past due",  className: "bg-orange-100 text-orange-700" },
  suspended: { label: "Suspended", className: "bg-red-100 text-red-700" },
  canceled:  { label: "Canceled",  className: "bg-gray-100 text-gray-500" },
  free:      { label: "Free",      className: "bg-gray-100 text-gray-600" },
};

export function TenantsList({ tenants, plans }: { tenants: Tenant[]; plans: Plan[] }) {
  const router = useRouter();
  const activePlans = plans.filter((p) => p.isActive);

  // ── General error / status ──────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState<string | null>(null);
  const [migratingAll, setMigratingAll] = useState(false);
  const [migrateAllResults, setMigrateAllResults] = useState<
    { subdomain: string; success: boolean; error?: string }[] | null
  >(null);
  const [migrateSuccess, setMigrateSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // ── Plan dialog ─────────────────────────────────────────────────────────────
  const [planDialogTenant, setPlanDialogTenant] = useState<Tenant | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string>("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const openPlanDialog = (tenant: Tenant) => {
    // Pre-select the current plan; fall back to the "free" plan entry if planId is null
    const currentId =
      tenant.planId ?? activePlans.find((p) => p.name === "free")?.id ?? "";
    setPlanDialogTenant(tenant);
    setPendingPlanId(currentId);
    setPlanError(null);
  };

  const closePlanDialog = () => {
    if (savingPlan) return;
    setPlanDialogTenant(null);
    setPendingPlanId("");
    setPlanError(null);
  };

  const handleSavePlan = async () => {
    if (!planDialogTenant || !pendingPlanId) return;
    setSavingPlan(true);
    setPlanError(null);
    try {
      await adminSetTenantPlan(planDialogTenant.id, pendingPlanId);
      setPlanDialogTenant(null);
      router.refresh();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setSavingPlan(false);
    }
  };

  // ── Migrations ──────────────────────────────────────────────────────────────
  const handleMigrateAll = async () => {
    setMigratingAll(true);
    setError(null);
    setMigrateAllResults(null);
    try {
      const results = await migrateAllTenants();
      setMigrateAllResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migrate all failed");
    } finally {
      setMigratingAll(false);
    }
  };

  const handleMigrate = async (subdomain: string) => {
    setMigrating(subdomain);
    setError(null);
    setMigrateSuccess(null);
    try {
      await migrateTenantDb(subdomain);
      setMigrateSuccess(subdomain);
      setTimeout(() => setMigrateSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(null);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async (subdomain: string) => {
    setLoading(true);
    setError(null);
    try {
      await deleteTenant(subdomain);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tenant");
    } finally {
      setLoading(false);
    }
  };

  // ── Copy URL ────────────────────────────────────────────────────────────────
  const handleCopyUrl = (subdomain: string) => {
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
    const url =
      process.env.NODE_ENV === "development"
        ? `http://${subdomain}.localhost:3000`
        : `https://${subdomain}.${rootDomain}`;
    navigator.clipboard.writeText(url);
    setCopied(subdomain);
    setTimeout(() => setCopied(null), 2000);
  };

  if (tenants.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No tenants yet. Create one using the form above.</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {/* ── Plan-change dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!planDialogTenant} onOpenChange={(open) => { if (!open) closePlanDialog(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Plan</DialogTitle>
          </DialogHeader>

          {planDialogTenant && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-500">Tenant: </span>
                <span className="font-medium text-gray-900">{planDialogTenant.name}</span>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-700">Current plan</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {planDialogTenant.planDisplayName ?? "Free"}
                  </span>
                  {planDialogTenant.subscriptionStatus && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      (STATUS_BADGE[planDialogTenant.subscriptionStatus] ?? STATUS_BADGE.free).className
                    }`}>
                      {(STATUS_BADGE[planDialogTenant.subscriptionStatus] ?? STATUS_BADGE.free).label}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-700">
                  New plan
                </label>
                <Select
                  value={pendingPlanId}
                  onValueChange={setPendingPlanId}
                  disabled={savingPlan}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {planError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                  {planError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closePlanDialog} disabled={savingPlan}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePlan}
              disabled={savingPlan || !pendingPlanId || pendingPlanId === (planDialogTenant?.planId ?? activePlans.find((p) => p.name === "free")?.id ?? "")}
            >
              {savingPlan && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main list ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleMigrateAll} disabled={migratingAll}>
            <DatabaseZap className="h-4 w-4 mr-1" />
            {migratingAll ? "Migrating all…" : "Migrate All DBs"}
          </Button>
        </div>

        {migrateAllResults && (
          <div className="rounded-lg border p-3 text-sm space-y-1">
            <p className="font-semibold text-gray-700 mb-2">Migration results:</p>
            {migrateAllResults.map((r) => (
              <div key={r.subdomain} className="flex items-center gap-2">
                {r.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                )}
                <code className="text-xs text-gray-700">{r.subdomain}</code>
                {!r.success && r.error && (
                  <span className="text-xs text-red-600 truncate">{r.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Tenant</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Subdomain</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Plan</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Created</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const settings = tenant.settings ? JSON.parse(tenant.settings) : {};
                const statusMeta =
                  STATUS_BADGE[tenant.subscriptionStatus ?? "free"] ?? STATUS_BADGE.free;

                return (
                  <tr key={tenant.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {settings.emoji && (
                          <span className="text-lg">{settings.emoji}</span>
                        )}
                        <div>
                          <div className="font-medium text-gray-900">{tenant.name}</div>
                          <div className="text-xs text-gray-400">
                            {tenant.id.slice(0, 8)}…
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <code className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700">
                        {tenant.subdomain}
                      </code>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <span className="block text-xs font-semibold text-gray-800">
                            {tenant.planDisplayName ?? "Free"}
                          </span>
                          <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.className}`}>
                            {statusMeta.label}
                          </span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-gray-400 hover:text-gray-700"
                          onClick={() => openPlanDialog(tenant)}
                          title="Change plan"
                          disabled={activePlans.length === 0}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-gray-500">
                      {format(new Date(tenant.createdAt), "MMM d, yyyy")}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/admin/tenants/${tenant.subdomain}`}>
                            <Users className="h-4 w-4" />
                            <span className="ml-1 text-xs">Members</span>
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMigrate(tenant.subdomain)}
                          disabled={migrating === tenant.subdomain}
                          title="Apply DB migrations"
                        >
                          {migrateSuccess === tenant.subdomain ? (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <span className="ml-1 text-xs">Migrated!</span>
                            </>
                          ) : (
                            <>
                              <DatabaseZap className="h-4 w-4" />
                              <span className="ml-1 text-xs">
                                {migrating === tenant.subdomain ? "Migrating…" : "Migrate DB"}
                              </span>
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyUrl(tenant.subdomain)}
                          title="Copy tenant URL"
                        >
                          {copied === tenant.subdomain ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              <span className="ml-1 text-xs">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              <span className="ml-1 text-xs">Copy URL</span>
                            </>
                          )}
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2 className="h-4 w-4" />
                              <span className="ml-1 text-xs">Delete</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Tenant?</AlertDialogTitle>
                              <AlertDialogDescription className="space-y-2">
                                <p>
                                  This will remove <strong>{tenant.name}</strong> from the registry.
                                </p>
                                <p className="text-xs text-orange-700 bg-orange-50 p-2 rounded">
                                  ⚠️ The database will NOT be deleted. You must manually delete{" "}
                                  <code>flux_tenant_{tenant.subdomain}</code> from PostgreSQL.
                                </p>
                                <p>This action cannot be undone.</p>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(tenant.subdomain)}
                              disabled={loading}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {loading ? "Deleting..." : "Delete Tenant"}
                            </AlertDialogAction>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-semibold mb-1">📋 Important Notes:</p>
          <ul className="list-inside list-disc space-y-1 text-xs">
            <li>Database URLs are encrypted but never shown in the UI</li>
            <li>Deleting a tenant only removes it from the registry</li>
            <li>The tenant database must be deleted manually via PostgreSQL</li>
            <li>Data of deleted tenants cannot be recovered</li>
          </ul>
        </div>
      </div>
    </>
  );
}

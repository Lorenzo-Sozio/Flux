"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { format, formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Clock, DatabaseZap, Loader2, Pencil, RefreshCw, Trash2, Users } from "lucide-react";

import { adminSetTenantPlan, adminSyncTenantSubscription } from "@/actions/admin-billing";
import { deleteTenant, migrateTenantDb } from "@/actions/tenants";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isFreePlan } from "@/lib/billing/free-plan";

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  settings: string | null;
  lastMigratedAt: Date | null;
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

type MigrateResult = { subdomain: string; success: boolean; error?: string };

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-700" },
  trialing: { label: "Trial", className: "bg-blue-100 text-blue-700" },
  past_due: { label: "Past due", className: "bg-orange-100 text-orange-700" },
  suspended: { label: "Suspended", className: "bg-red-100 text-red-700" },
  canceled: { label: "Canceled", className: "bg-gray-100 text-gray-500" },
  free: { label: "Free", className: "bg-gray-100 text-gray-600" },
};

export function TenantsList({ tenants, plans }: { tenants: Tenant[]; plans: Plan[] }) {
  const router = useRouter();
  const activePlans = plans.filter((p) => p.isActive);

  // ── General error / status ──────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState<string | null>(null);
  const [migratingAll, setMigratingAll] = useState(false);
  const [migrateAllResults, setMigrateAllResults] = useState<MigrateResult[] | null>(null);
  const [migrateAllDone, setMigrateAllDone] = useState<{ passed: number; failed: number } | null>(null);
  const [migrateSuccess, setMigrateSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Plan dialog ─────────────────────────────────────────────────────────────
  const [planDialogTenant, setPlanDialogTenant] = useState<Tenant | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string>("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // ── Stripe sync ─────────────────────────────────────────────────────────────
  const [syncingTenantId, setSyncingTenantId] = useState<string | null>(null);

  const handleSyncStripe = async (tenant: Tenant) => {
    setSyncingTenantId(tenant.id);
    setError(null);
    try {
      await adminSyncTenantSubscription(tenant.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingTenantId(null);
    }
  };

  const openPlanDialog = (tenant: Tenant) => {
    const currentId = tenant.planId ?? activePlans.find(isFreePlan)?.id ?? "";
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

  // ── Migrate all (SSE stream) ─────────────────────────────────────────────────
  const handleMigrateAll = async () => {
    setMigratingAll(true);
    setError(null);
    setMigrateAllResults([]);
    setMigrateAllDone(null);

    try {
      const res = await fetch("/api/admin/migrate-all");
      if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine);
            if (parsed.type === "done") {
              setMigrateAllDone({ passed: parsed.passed, failed: parsed.failed });
            } else {
              setMigrateAllResults((prev) => [...(prev ?? []), parsed as MigrateResult]);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migrate all failed");
    } finally {
      setMigratingAll(false);
    }
  };

  // ── Migrate single ───────────────────────────────────────────────────────────
  const handleMigrate = async (subdomain: string) => {
    setMigrating(subdomain);
    setError(null);
    setMigrateSuccess(null);
    try {
      await migrateTenantDb(subdomain);
      setMigrateSuccess(subdomain);
      router.refresh();
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
      <Dialog
        open={!!planDialogTenant}
        onOpenChange={(open) => {
          if (!open) closePlanDialog();
        }}
      >
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
                <p className="font-medium text-gray-700 text-xs">Current plan</p>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm">
                    {planDialogTenant.planDisplayName ?? "Free"}
                  </span>
                  {planDialogTenant.subscriptionStatus && (
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${
                        (STATUS_BADGE[planDialogTenant.subscriptionStatus] ?? STATUS_BADGE.free).className
                      }`}
                    >
                      {(STATUS_BADGE[planDialogTenant.subscriptionStatus] ?? STATUS_BADGE.free).label}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="plan-select" className="font-medium text-gray-700 text-xs">
                  New plan
                </label>
                <Select value={pendingPlanId} onValueChange={setPendingPlanId} disabled={savingPlan}>
                  <SelectTrigger id="plan-select">
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

              {planError && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700 text-xs">{planError}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closePlanDialog} disabled={savingPlan}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePlan}
              disabled={
                savingPlan ||
                !pendingPlanId ||
                pendingPlanId === (planDialogTenant?.planId ?? activePlans.find(isFreePlan)?.id ?? "")
              }
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

        <div className="flex items-center justify-between">
          <div className="text-muted-foreground text-xs">
            {migratingAll && (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Migrating… {migrateAllResults?.length ?? 0}/{tenants.length}
              </span>
            )}
            {!migratingAll && migrateAllDone && (
              <span className="text-gray-600">
                Last run: {migrateAllDone.passed} ok, {migrateAllDone.failed} failed
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleMigrateAll} disabled={migratingAll}>
            {migratingAll ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Migrating…
              </>
            ) : (
              <>
                <DatabaseZap className="mr-1 h-4 w-4" />
                Migrate All DBs
              </>
            )}
          </Button>
        </div>

        {/* SSE results panel */}
        {migrateAllResults && migrateAllResults.length > 0 && (
          <div className="space-y-1 rounded-lg border p-3 text-sm">
            <p className="mb-2 font-semibold text-gray-700">Migration results:</p>
            {migrateAllResults.map((r) => (
              <div key={r.subdomain} className="flex items-center gap-2">
                {r.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                )}
                <code className="text-gray-700 text-xs">{r.subdomain}</code>
                {!r.success && r.error && <span className="truncate text-red-600 text-xs">{r.error}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-gray-200 border-b bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Tenant</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Identifier</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Plan</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Last migrated</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Created</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => {
                const settings = tenant.settings ? JSON.parse(tenant.settings) : {};
                const statusMeta = STATUS_BADGE[tenant.subscriptionStatus ?? "free"] ?? STATUS_BADGE.free;
                const isMigratingThis = migrating === tenant.subdomain;
                const isMigratedSuccess = migrateSuccess === tenant.subdomain;

                return (
                  <tr key={tenant.id} className="border-gray-100 border-b hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {settings.emoji && <span className="text-lg">{settings.emoji}</span>}
                        <div>
                          <div className="font-medium text-gray-900">{tenant.name}</div>
                          <div className="text-gray-400 text-xs">{tenant.id.slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <code className="rounded bg-gray-100 px-2 py-1 font-mono text-gray-700 text-xs">
                        {tenant.subdomain}
                      </code>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <span className="block font-semibold text-gray-800 text-xs">
                            {tenant.planDisplayName ?? "Free"}
                          </span>
                          <span
                            className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 font-medium text-[10px] ${statusMeta.className}`}
                          >
                            {statusMeta.label}
                          </span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-gray-400 hover:text-gray-700"
                          onClick={() => openPlanDialog(tenant)}
                          title="Override plan manually"
                          disabled={activePlans.length === 0}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-gray-400 hover:text-blue-600"
                          onClick={() => handleSyncStripe(tenant)}
                          title="Reset to Stripe data"
                          disabled={syncingTenantId === tenant.id}
                        >
                          <RefreshCw className={`h-3 w-3 ${syncingTenantId === tenant.id ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </td>

                    {/* Last migrated column */}
                    <td className="px-4 py-3">
                      {tenant.lastMigratedAt ? (
                        <span
                          className="flex items-center gap-1 text-gray-500 text-xs"
                          title={format(new Date(tenant.lastMigratedAt), "PPpp")}
                        >
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatDistanceToNow(new Date(tenant.lastMigratedAt), { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-[10px] text-amber-700">
                          Never
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-gray-500 text-xs">
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
                          disabled={isMigratingThis || migratingAll}
                          title="Apply DB migrations"
                        >
                          {isMigratedSuccess ? (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <span className="ml-1 text-xs">Migrated!</span>
                            </>
                          ) : (
                            <>
                              <DatabaseZap className="h-4 w-4" />
                              <span className="ml-1 text-xs">{isMigratingThis ? "Migrating…" : "Migrate DB"}</span>
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
                                  This will remove <strong>{tenant.name}</strong> from the registry. All SSO access for
                                  members of this tenant will be revoked immediately.
                                </p>
                                <p className="rounded bg-orange-50 p-2 text-orange-700 text-xs">
                                  ⚠️ The database will NOT be deleted. You must manually drop the tenant database from
                                  PostgreSQL (identifier: <code>{tenant.subdomain}</code>).
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

        <div className="rounded-lg bg-amber-50 p-3 text-amber-800 text-sm">
          <p className="mb-1 font-semibold">📋 Important Notes:</p>
          <ul className="list-inside list-disc space-y-1 text-xs">
            <li>Database URLs are encrypted and never exposed in the UI</li>
            <li>Users access tenants via centralized SSO — no subdomain routing is used</li>
            <li>Deleting a tenant removes it from the registry and revokes all member access</li>
            <li>The tenant database must be dropped manually via PostgreSQL</li>
            <li>Data of deleted tenants cannot be recovered</li>
          </ul>
        </div>
      </div>
    </>
  );
}

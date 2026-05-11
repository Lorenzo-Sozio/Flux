"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteTenant, migrateAllTenants, migrateTenantDb, updateTenant } from "@/actions/tenants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Trash2, Copy, CheckCircle2, DatabaseZap, Users } from "lucide-react";
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

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  settings: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function TenantsList({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState<string | null>(null);
  const [migratingAll, setMigratingAll] = useState(false);
  const [migrateAllResults, setMigrateAllResults] = useState<{ subdomain: string; success: boolean; error?: string }[] | null>(null);
  const [migrateSuccess, setMigrateSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleMigrateAll}
          disabled={migratingAll}
        >
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
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Tenant
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Subdomain
              </th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">
                Created
              </th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => {
              const settings = tenant.settings ? JSON.parse(tenant.settings) : {};
              return (
                <tr
                  key={tenant.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {settings.emoji && (
                        <span className="text-lg">{settings.emoji}</span>
                      )}
                      <div>
                        <div className="font-medium text-gray-900">
                          {tenant.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          ID: {tenant.id.slice(0, 8)}...
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700">
                      {tenant.subdomain}
                    </code>
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
                                This will remove <strong>{tenant.name}</strong>{" "}
                                from the registry.
                              </p>
                              <p className="text-xs text-orange-700 bg-orange-50 p-2 rounded">
                                ⚠️ The database will NOT be deleted. You must
                                manually delete <code>flux_tenant_{tenant.subdomain}</code> from PostgreSQL.
                              </p>
                              <p>This action cannot be undone.</p>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              handleDelete(tenant.subdomain)
                            }
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
  );
}

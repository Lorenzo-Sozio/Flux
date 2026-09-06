"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { validateTenantSwitchAction } from "@/actions/auth";

type Membership = {
  tenantId: string;
  role: string;
  tenantName: string;
  tenantSubdomain: string;
  tenantSettings: string | null;
};

interface TenantSwitcherProps {
  memberships: Membership[];
}

export function TenantSwitcher({ memberships }: TenantSwitcherProps) {
  const { update } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleSelect(tenantId: string) {
    setLoading(tenantId);
    try {
      // Server-side membership validation
      const result = await validateTenantSwitchAction(tenantId);
      if (!result.ok) {
        toast.error(result.error ?? "Failed to switch workspace.");
        return;
      }

      // Persist activeTenantId in the JWT via NextAuth session update
      await update({ activeTenantId: tenantId });

      router.push("/dashboard/crm");
      router.refresh();
    } catch {
      toast.error("An unexpected error occurred.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-3xl shadow-md ring-1 ring-slate-200">
            🧩
          </div>
          <h1 className="font-bold text-2xl text-slate-900">Select workspace</h1>
          <p className="mt-1 text-slate-500 text-sm">Choose the workspace you want to access.</p>
        </div>

        <div className="flex flex-col gap-3">
          {memberships.map(({ tenantId, tenantName, tenantSettings, role }) => {
            const settings = (() => {
              try {
                return tenantSettings ? JSON.parse(tenantSettings) : {};
              } catch {
                return {};
              }
            })();
            const isLoading = loading === tenantId;

            return (
              <button
                key={tenantId}
                type="button"
                disabled={isLoading || loading !== null}
                onClick={() => handleSelect(tenantId)}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm transition hover:border-slate-400 hover:shadow-md disabled:opacity-60"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl">
                  {settings.emoji ?? "🏢"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900 text-sm">{tenantName}</p>
                  <p className="text-slate-500 text-xs capitalize">{role}</p>
                </div>
                {isLoading && (
                  <svg
                    className="h-4 w-4 animate-spin text-slate-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

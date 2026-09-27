"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { validateTenantSwitchAction } from "@/actions/auth";
import { normalizeTenantRole } from "@/lib/permissions";

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
  const t = useTranslations("auth.workspaces");
  const tr = useTranslations("roles.roleLabel");

  async function handleSelect(tenantId: string) {
    setLoading(tenantId);
    try {
      // Server-side membership validation
      const result = await validateTenantSwitchAction(tenantId);
      if (!result.ok) {
        toast.error(result.error ?? t("switchFailed"));
        return;
      }

      // Persist activeTenantId in the JWT via NextAuth session update
      await update({ activeTenantId: tenantId });

      router.push("/dashboard/crm");
      router.refresh();
    } catch {
      toast.error(t("unexpected"));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-bold text-2xl">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
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
                className="flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 text-left text-card-foreground shadow-sm transition hover:border-foreground/30 hover:shadow-md disabled:opacity-60"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
                  {settings.emoji ?? "🏢"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-sm">{tenantName}</p>
                  <p className="text-muted-foreground text-xs">{tr(normalizeTenantRole(role))}</p>
                </div>
                {isLoading && (
                  <svg
                    className="h-4 w-4 animate-spin text-muted-foreground"
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

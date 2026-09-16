import Link from "next/link";

import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getActor } from "@/lib/auth-guard";
import { CAPABILITIES, type Capability } from "@/lib/permissions";

/**
 * Says what was refused and who can undo it.
 *
 * Pages used to bounce the user to the dashboard with nothing said, which reads
 * as the application ignoring the click (audit rilievo P-01). The guard now sends
 * the missing capability here, so the page can name the role that would have it.
 */
/** What each capability lets somebody do, as keys under `serverErrors.unauthorized.what`. */
const CAPABILITY_LABELS: Partial<Record<Capability, string>> = {
  "user:read": "manageUsers",
  "user:manage": "manageUsers",
  "settings:read": "openSettings",
  "settings:manage": "changeSettings",
  "billing:read": "seeSubscription",
  "billing:manage": "changeSubscription",
  "webhook:manage": "manageWebhooks",
  "customField:manage": "manageCustomFields",
  "pipeline:manage": "changePipeline",
  "sla:manage": "changeSla",
  "report:read": "openReports",
  "report:manage": "saveReports",
  "automation:manage": "manageAutomation",
  "macro:manage": "manageMacros",
  "record:write": "makeChanges",
};

export default async function UnauthorizedPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const [t, tu, params, actor] = await Promise.all([
    getTranslations("errors"),
    getTranslations("serverErrors.unauthorized"),
    searchParams,
    getActor(),
  ]);
  const roleName = (role: string) => tu(`roles.${role}`);

  const need = params.need as Capability | undefined;
  const requiredRole = need && need in CAPABILITIES ? CAPABILITIES[need] : null;
  const what = need ? CAPABILITY_LABELS[need] : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md text-center">
        <Lock className="mx-auto size-12 text-primary" />
        <h1 className="mt-4 font-bold text-3xl tracking-tight sm:text-4xl">{t("unauthorized")}</h1>

        {requiredRole ? (
          <p className="mt-4 text-muted-foreground">
            {what
              ? tu("onlyRoleCan", { role: roleName(requiredRole), what: tu(`what.${what}`) })
              : tu("needsRole", { role: roleName(requiredRole) })}
            {actor ? ` ${tu("yourRole", { role: roleName(actor.tenantRole) })}` : ""}
          </p>
        ) : (
          <p className="mt-4 text-muted-foreground">{t("unauthorizedDescription")}</p>
        )}

        <p className="mt-2 text-muted-foreground text-sm">{tu("howToChange")}</p>

        <div className="mt-6">
          <Link
            href="/dashboard/crm"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm shadow-xs transition-colors hover:bg-primary/90 focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2"
            prefetch={false}
          >
            {t("backToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}

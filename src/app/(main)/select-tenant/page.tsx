import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { getTenantMembershipsAction, logoutAction } from "@/actions/auth";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";

import { TenantSwitcher } from "./_components/tenant-switcher";

export default async function SelectTenantPage() {
  const session = await auth();

  if (!session?.user?.id) redirect("/auth/v1/login");

  // If the user already has an active tenant in the JWT, skip this page
  if (session.user.activeTenantId) redirect("/dashboard/crm");

  const memberships = await getTenantMembershipsAction();

  // ⚠️ Not a dead end. This is where every new sign-up lands, and it used to say only
  // "contact an administrator" — to someone who had no administrator. The two real cases
  // are named, the staff who create workspaces have already been told (platform-staff.ts),
  // and there is a way out of the session.
  if (memberships.length === 0) {
    const t = await getTranslations("auth.workspaces");
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card px-6 py-8 text-card-foreground shadow-sm sm:px-8">
          <div className="text-center">
            <h1 className="font-semibold text-xl">{t("noneTitle")}</h1>
            <p className="mt-1 text-muted-foreground text-sm">{t("noneLead")}</p>
          </div>
          <div className="space-y-1.5">
            <h2 className="font-medium text-sm">{t("invitedTitle")}</h2>
            <p className="text-muted-foreground text-sm">{t("invitedBody")}</p>
          </div>
          <div className="space-y-1.5">
            <h2 className="font-medium text-sm">{t("newTitle")}</h2>
            <p className="text-muted-foreground text-sm">{t("newBody", { email: session.user.email ?? "" })}</p>
          </div>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="w-full">
              {t("signOut")}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return <TenantSwitcher memberships={memberships} />;
}

import Link from "next/link";
import { Settings2, Webhook, Mail } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (!["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  const t = await getTranslations("settings");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("general.title")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/dashboard/settings/custom-fields">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <Settings2 className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{t("customFields.title")}</CardTitle>
              <CardDescription>
                {t("customFields.description")}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/dashboard/settings/webhooks">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <Webhook className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{t("webhooks.title")}</CardTitle>
              <CardDescription>
                {t("webhooks.description")}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/dashboard/settings/email">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <Mail className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>{t("email.title")}</CardTitle>
              <CardDescription>
                {t("email.description")}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}

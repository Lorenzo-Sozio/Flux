import { getAllSlas } from "@/actions/sla";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SlaClient } from "./_components/sla-client";

export default async function SlaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role;
  if (!["admin", "owner"].includes(role ?? "")) redirect("/dashboard");

  const [slaList, t] = await Promise.all([getAllSlas(), getTranslations("support.sla")]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <SlaClient slas={slaList} />
    </div>
  );
}

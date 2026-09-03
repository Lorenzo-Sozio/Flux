import { redirect } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { getMacros } from "@/actions/support";
import { auth } from "@/auth";
import { LOGIN_PATH } from "@/lib/page-guard";

import { MacrosClient } from "./_components/macros-client";

export default async function MacrosPage() {
  const session = await auth();
  if (!session?.user) redirect(LOGIN_PATH);

  const [macros, t] = await Promise.all([getMacros(), getTranslations("support.macros")]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <MacrosClient macros={macros} />
    </div>
  );
}

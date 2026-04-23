"use client";

import { useTranslations } from "next-intl";

export default function DashboardNotFound() {
  const t = useTranslations("errors");
  return (
    <div className="flex h-full flex-col items-center justify-center space-y-2 text-center">
      <h1 className="font-semibold text-2xl">{t("404")}</h1>
      <p className="text-muted-foreground">{t("404Description")}</p>
    </div>
  );
}

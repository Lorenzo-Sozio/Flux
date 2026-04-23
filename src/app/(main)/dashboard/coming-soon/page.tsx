import { getTranslations } from "next-intl/server";

export default async function ComingSoonPage() {
  const t = await getTranslations("errors");
  return (
    <div className="flex h-full flex-col items-center justify-center space-y-2 text-center">
      <h1 className="font-semibold text-2xl">{t("comingSoon")}</h1>
      <p className="text-muted-foreground">{t("comingSoonDescription")}</p>
    </div>
  );
}

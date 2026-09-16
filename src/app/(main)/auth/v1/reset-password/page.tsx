import Link from "next/link";

import { Command } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ResetPasswordForm } from "../../_components/reset-password-form";

interface Props {
  searchParams: Promise<{ token?: string; email?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, email } = await searchParams;
  const t = await getTranslations("auth.resetPasswordPage");

  if (!token || !email) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">{t("invalidTitle")}</h2>
          <p className="text-muted-foreground">{t("invalidDesc")}</p>
          <Link href="/auth/v1/forgot-password" className="text-primary hover:underline">
            {t("requestNew")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="space-y-2">
              <h1 className="font-light text-5xl text-primary-foreground">{t("sidebarTitle")}</h1>
              <p className="text-primary-foreground/80 text-xl">{t("sidebarSubtitle")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center overflow-y-auto bg-background p-4 sm:p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-8 py-8 sm:space-y-10 sm:py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <div className="font-medium tracking-tight">{t("formTitle")}</div>
            <div className="mx-auto max-w-xl text-muted-foreground">
              {t.rich("resettingFor", { email, strong: (chunks) => <strong>{chunks}</strong> })}
            </div>
          </div>
          <ResetPasswordForm email={email} token={token} />
        </div>
      </div>
    </div>
  );
}

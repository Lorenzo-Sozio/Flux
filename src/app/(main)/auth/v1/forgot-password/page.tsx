import Link from "next/link";

import { Command } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ForgotPasswordForm } from "../../_components/forgot-password-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgotPassword");

  return (
    <div className="flex h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="space-y-2">
              <h1 className="font-light text-5xl text-primary-foreground">{t("title")}</h1>
              <p className="text-primary-foreground/80 text-xl">{t("sidebarSubtitle")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-10 py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <div className="font-medium tracking-tight">{t("formTitle")}</div>
            <div className="mx-auto max-w-xl text-muted-foreground">{t("formSubtitle")}</div>
          </div>
          <div className="space-y-4">
            <ForgotPasswordForm />
            <p className="text-center text-muted-foreground text-xs">
              {t("rememberedIt")}{" "}
              <Link prefetch={false} href="/auth/v1/login" className="text-primary">
                {t("backToLogin")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

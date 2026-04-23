import Link from "next/link";
import { Command } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "../../_components/login-form";
import { GoogleButton } from "../../_components/social-auth/google-button";
import { DemoCredentialsBanner } from "../../_components/demo-credentials-banner";

export default async function LoginV1() {
  const t = await getTranslations("auth.login");
  return (
    <div className="flex h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="space-y-2">
              <h1 className="font-light text-5xl text-primary-foreground">{t("title")}</h1>
              <p className="text-primary-foreground/80 text-xl">{t("subtitle")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-6 py-16 lg:py-24">
          <div className="space-y-2 text-center">
            <div className="font-medium tracking-tight">{t("signIn")}</div>
            <div className="mx-auto max-w-xl text-muted-foreground text-sm">
              {t("subtitle")}
            </div>
          </div>

          <DemoCredentialsBanner />

          <div className="space-y-4">
            <LoginForm />
            <GoogleButton className="w-full" variant="outline" />
            <p className="text-center text-muted-foreground text-xs">
              {t("noAccount")}{" "}
              <Link prefetch={false} href="register" className="text-primary">
                {t("createAccount")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

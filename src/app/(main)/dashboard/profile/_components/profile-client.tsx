"use client";

import { type ReactNode, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { BellRing, ChevronRight } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { changePasswordAction } from "@/actions/auth";
import { updateOwnNameAction } from "@/actions/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The signed-in person's own account: their name, their password, their email archive, their notifications. */
export function ProfileClient({
  name: initialName,
  email,
  hasPassword,
  archive,
}: {
  name: string;
  email: string;
  hasPassword: boolean;
  /** The Bcc archive address card, rendered by the page with what the server knows. */
  archive?: ReactNode;
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const { update } = useSession();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(initialName);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const saveName = () =>
    startTransition(async () => {
      const result = await updateOwnNameAction(name).catch(() => null);
      if (!result) {
        toast.error(t("failed"));
        return;
      }
      if (!result.ok) {
        toast.error(t(`name.errors.${result.reason}`));
        return;
      }
      // The name in the menu comes from the session; ask it to read the account again.
      await update({ refreshProfile: true }).catch(() => undefined);
      router.refresh();
      toast.success(t("saved"));
    });

  const savePassword = () => {
    if (next.length < 8) {
      toast.error(t("password.tooShort"));
      return;
    }
    if (next !== confirm) {
      toast.error(t("password.mismatch"));
      return;
    }
    startTransition(async () => {
      const result = await changePasswordAction({ currentPassword: current, newPassword: next }).catch(() => null);
      if (!result) {
        toast.error(t("failed"));
        return;
      }
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("password.changed"));
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("name.title")}</CardTitle>
          <CardDescription>{t("name.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">{t("name.label")}</Label>
              <Input id="profile-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-email">{t("email.label")}</Label>
              <Input id="profile-email" value={email} readOnly disabled />
              <p className="text-muted-foreground text-xs">{t("email.help")}</p>
            </div>
          </div>
          <Button onClick={saveName} disabled={pending || !name.trim() || name.trim() === initialName}>
            {t("save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("password.title")}</CardTitle>
          <CardDescription>{hasPassword ? t("password.help") : t("password.social")}</CardDescription>
        </CardHeader>
        {hasPassword && (
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                savePassword();
              }}
            >
              <div className="space-y-1.5 sm:max-w-sm">
                <Label htmlFor="pw-current">{t("password.current")}</Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-new">{t("password.new")}</Label>
                  <Input
                    id="pw-new"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    required
                  />
                  <p className="text-muted-foreground text-xs">{t("password.rule")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-confirm">{t("password.confirm")}</Label>
                  <Input
                    id="pw-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={pending || !current || !next || !confirm}>
                {t("password.submit")}
              </Button>
            </form>
          </CardContent>
        )}
      </Card>

      {archive}

      <Link href="/dashboard/settings/notifications">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center gap-3">
            <BellRing className="size-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="text-base">{t("notifications.title")}</CardTitle>
              <CardDescription>{t("notifications.help")}</CardDescription>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { SignatureIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { type OwnSignature, saveOwnSignatureAction } from "@/actions/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type SignatureVariant, signatureHtml, signaturePerson } from "@/lib/email-brand";

/**
 * The person's email signature: their role and phones, beside the workspace's identity (logo,
 * colour, address, VAT number, website, socials), which is the same for everybody and changed
 * in Settings → General. The preview is drawn by the function that draws the email's.
 */
export function SignatureCard({ initial, canEditBrand }: { initial: OwnSignature; canEditBrand: boolean }) {
  const t = useTranslations("profile.signature");
  const tp = useTranslations("profile");
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState(initial.settings);
  const [variant, setVariant] = useState<SignatureVariant>("full");
  const lang = useLocale() === "en" ? "en" : "it";

  const html = useMemo(
    () =>
      signatureHtml({
        person: signaturePerson(initial.person, settings),
        brand: initial.brand,
        variant,
        lang,
      }),
    [initial, settings, variant, lang],
  );

  const set = <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const save = () =>
    startTransition(async () => {
      try {
        setSettings(await saveOwnSignatureAction(settings));
        toast.success(tp("saved"));
      } catch {
        toast.error(tp("failed"));
      }
    });

  return (
    <Card id="signature" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SignatureIcon className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="signature-enabled" className="min-w-0">
            {t("enabled")}
          </Label>
          <Switch id="signature-enabled" checked={settings.enabled} onCheckedChange={(on) => set("enabled", on)} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="signature-title">{t("role")}</Label>
            <Input
              id="signature-title"
              value={settings.title}
              maxLength={120}
              onChange={(e) => set("title", e.target.value)}
              placeholder={t("rolePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signature-mobile">{t("mobile")}</Label>
            <Input
              id="signature-mobile"
              type="tel"
              inputMode="tel"
              value={settings.mobile}
              maxLength={120}
              onChange={(e) => set("mobile", e.target.value)}
              placeholder="+39 333 123 4567"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signature-phone">{t("phone")}</Label>
            <Input
              id="signature-phone"
              type="tel"
              inputMode="tel"
              value={settings.phone}
              maxLength={120}
              onChange={(e) => set("phone", e.target.value)}
              placeholder={initial.brand.phone ?? "+39 02 1234 5678"}
            />
            <p className="text-muted-foreground text-xs">{t("phoneHelp")}</p>
          </div>
        </div>

        {initial.person.image && (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="signature-photo" className="min-w-0">
              {t("photo")}
            </Label>
            <Switch id="signature-photo" checked={settings.usePhoto} onCheckedChange={(on) => set("usePhoto", on)} />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-sm">{t("preview")}</p>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={variant}
              onValueChange={(v) => v && setVariant(v as SignatureVariant)}
              aria-label={t("variant")}
            >
              <ToggleGroupItem value="full">{t("full")}</ToggleGroupItem>
              <ToggleGroupItem value="compact">{t("compact")}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {/* Its own document, as in the email dialog: the email's styles stay out of the page's. */}
          <iframe
            title={t("preview")}
            sandbox=""
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0;padding:20px;background:#fff">${html}</body></html>`}
            className={`h-56 w-full rounded-md border bg-white ${settings.enabled ? "" : "opacity-50"}`}
          />
          <p className="text-muted-foreground text-xs">
            {variant === "full" ? t("fullHelp") : t("compactHelp")}{" "}
            {canEditBrand ? (
              <Link href="/dashboard/settings/general" className="underline underline-offset-2">
                {t("brandLink")}
              </Link>
            ) : (
              t("brandByAdmin")
            )}
          </p>
        </div>

        <Button onClick={save} disabled={pending}>
          {tp("save")}
        </Button>
      </CardContent>
    </Card>
  );
}

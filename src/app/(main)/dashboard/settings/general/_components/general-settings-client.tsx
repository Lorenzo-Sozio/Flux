"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import { ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  removeWorkspaceLogoAction,
  saveApprovalPolicyAction,
  saveQuoteDefaultsAction,
  saveWorkspaceTimeZoneAction,
  uploadWorkspaceLogoAction,
} from "@/actions/workspace-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import type { BrandIdentity } from "@/lib/email-brand";
import type { ApprovalPolicy } from "@/lib/quote-status";
import type { QuoteDefaults } from "@/lib/workspace-preferences";

import { BrandIdentityCard } from "./brand-identity-card";

/** Every zone the browser knows, with the current one kept even if it does not. */
function zoneOptions(current: string) {
  const zones: string[] =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Europe/Rome", "UTC"];
  const all = zones.includes(current) ? zones : [current, ...zones];
  return all.map((z) => ({ value: z, label: z.replaceAll("_", " ") }));
}

/**
 * The workspace's own settings, in one place: its clock, what a new quote starts with,
 * and the logo on its documents.
 */
export function GeneralSettingsClient({
  timeZone: initialZone,
  quoteDefaults,
  hasLogo: initialHasLogo,
  approval,
  brand,
}: {
  timeZone: string;
  quoteDefaults: QuoteDefaults;
  hasLogo: boolean;
  approval: ApprovalPolicy;
  brand: BrandIdentity;
}) {
  const t = useTranslations("settings.generalPage");
  const [pending, startTransition] = useTransition();

  const [zone, setZone] = useState(initialZone);
  const options = useMemo(() => zoneOptions(initialZone), [initialZone]);

  const [validityDays, setValidityDays] = useState(String(quoteDefaults.validityDays));
  const [terms, setTerms] = useState(quoteDefaults.terms);

  const [maxDiscount, setMaxDiscount] = useState(String(approval.maxDiscountPercent));
  const [maxTotal, setMaxTotal] = useState(String(approval.maxTotalAmount));
  const [hasLogo, setHasLogo] = useState(initialHasLogo);
  // Changes the preview's address after an upload, so the browser asks for the new image.
  const [logoVersion, setLogoVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveZone = () =>
    startTransition(async () => {
      const result = await saveWorkspaceTimeZoneAction(zone).catch(() => ({ ok: false }));
      if (result.ok) toast.success(t("saved"));
      else toast.error(t("timeZone.invalid"));
    });

  const saveQuotes = () =>
    startTransition(async () => {
      try {
        const saved = await saveQuoteDefaultsAction({ validityDays: Number(validityDays), terms });
        setValidityDays(String(saved.validityDays));
        setTerms(saved.terms);
        toast.success(t("saved"));
      } catch {
        toast.error(t("failed"));
      }
    });

  const saveApproval = () =>
    startTransition(async () => {
      try {
        const saved = await saveApprovalPolicyAction({
          maxDiscountPercent: Number(maxDiscount),
          maxTotalAmount: Number(maxTotal),
        });
        setMaxDiscount(String(saved.maxDiscountPercent));
        setMaxTotal(String(saved.maxTotalAmount));
        toast.success(t("saved"));
      } catch {
        toast.error(t("failed"));
      }
    });

  const upload = (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.append("logo", file);
    startTransition(async () => {
      const result = await uploadWorkspaceLogoAction(form).catch(() => ({
        ok: false as const,
        reason: "storage" as const,
      }));
      if (fileRef.current) fileRef.current.value = "";
      if (result.ok) {
        setHasLogo(true);
        setLogoVersion((v) => v + 1);
        toast.success(t("saved"));
      } else {
        toast.error(t(`logo.errors.${result.reason}`));
      }
    });
  };

  const removeLogo = () =>
    startTransition(async () => {
      try {
        await removeWorkspaceLogoAction();
        setHasLogo(false);
        toast.success(t("saved"));
      } catch {
        toast.error(t("failed"));
      }
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("timeZone.title")}</CardTitle>
          <CardDescription>{t("timeZone.help")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchableSelect
            options={options}
            value={zone}
            onChange={setZone}
            className="sm:max-w-sm"
            searchPlaceholder={t("timeZone.search")}
          />
          <Button onClick={saveZone} disabled={pending || zone === initialZone}>
            {t("save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("quotes.title")}</CardTitle>
          <CardDescription>{t("quotes.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="validity">{t("quotes.validity")}</Label>
            <Input
              id="validity"
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
              className="w-32"
            />
            <p className="text-muted-foreground text-xs">{t("quotes.validityHelp")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="terms">{t("quotes.terms")}</Label>
            <Textarea
              id="terms"
              rows={6}
              value={terms}
              maxLength={5000}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={t("quotes.termsPlaceholder")}
            />
            <p className="text-muted-foreground text-xs">{t("quotes.termsHelp")}</p>
          </div>
          <Button onClick={saveQuotes} disabled={pending}>
            {t("save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("approval.title")}</CardTitle>
          <CardDescription>{t("approval.help")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="approval-discount">{t("approval.maxDiscount")}</Label>
              <Input
                id="approval-discount"
                type="number"
                min={0}
                max={100}
                inputMode="decimal"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="approval-total">{t("approval.maxTotal")}</Label>
              <Input
                id="approval-total"
                type="number"
                min={0}
                inputMode="decimal"
                value={maxTotal}
                onChange={(e) => setMaxTotal(e.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{t("approval.zeroOff")}</p>
          <Button onClick={saveApproval} disabled={pending}>
            {t("save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("logo.title")}</CardTitle>
          <CardDescription>{t("logo.help")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-16 w-48 shrink-0 items-center justify-center rounded-md border bg-muted/30 p-2">
            {hasLogo ? (
              // biome-ignore lint/performance/noImgElement: a private, authenticated image; next/image would cache it publicly
              <img
                src={`/api/workspace/logo?v=${logoVersion}`}
                alt={t("logo.alt")}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <ImageIcon className="size-6 text-muted-foreground" aria-label={t("logo.none")} />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={pending}>
              <UploadIcon className="mr-2 size-4" aria-hidden />
              {hasLogo ? t("logo.replace") : t("logo.upload")}
            </Button>
            {hasLogo && (
              <Button variant="ghost" onClick={removeLogo} disabled={pending}>
                <Trash2Icon className="mr-2 size-4" aria-hidden />
                {t("logo.remove")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <BrandIdentityCard initial={brand} />
    </div>
  );
}

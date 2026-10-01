"use client";

import { useState, useTransition } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { saveBrandIdentityAction } from "@/actions/workspace-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type BrandIdentity,
  cleanColor,
  cleanUrl,
  DEFAULT_BRAND_COLOR,
  inkOn,
  SOCIAL_KINDS,
  type SocialKind,
} from "@/lib/email-brand";

const SOCIAL_PLACEHOLDER: Record<SocialKind, string> = {
  linkedin: "https://www.linkedin.com/company/…",
  instagram: "https://www.instagram.com/…",
  facebook: "https://www.facebook.com/…",
  x: "https://x.com/…",
  youtube: "https://www.youtube.com/@…",
};

/**
 * The identity on every email to a customer: the brand colour (buttons, the bar on top, the
 * signature's details), the website and the social pages shown in the signatures.
 */
export function BrandIdentityCard({ initial }: { initial: BrandIdentity }) {
  const t = useTranslations("settings.generalPage.brand");
  const tp = useTranslations("settings.generalPage");
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState(initial.color);
  const [website, setWebsite] = useState(initial.website ?? "");
  const [socials, setSocials] = useState<Record<SocialKind, string>>(
    () => Object.fromEntries(SOCIAL_KINDS.map((k) => [k, initial.socials[k] ?? ""])) as Record<SocialKind, string>,
  );

  const shown = cleanColor(color) ?? DEFAULT_BRAND_COLOR;
  // A link that will be dropped is said before the save, not discovered after it.
  const wrong = (value: string) => value.trim() !== "" && !cleanUrl(value);

  const save = () =>
    startTransition(async () => {
      try {
        const saved = await saveBrandIdentityAction({
          color: shown,
          website: website.trim() || null,
          socials: Object.fromEntries(SOCIAL_KINDS.map((k) => [k, socials[k].trim()]).filter(([, v]) => v)),
        });
        setColor(saved.color);
        setWebsite(saved.website ?? "");
        setSocials(
          Object.fromEntries(SOCIAL_KINDS.map((k) => [k, saved.socials[k] ?? ""])) as Record<SocialKind, string>,
        );
        toast.success(tp("saved"));
      } catch {
        toast.error(tp("failed"));
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("help")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="brand-color">{t("color")}</Label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="brand-color"
              type="color"
              value={shown}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-md border bg-background p-1"
            />
            <Input
              aria-label={t("colorHex")}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-32 font-mono"
              maxLength={7}
            />
            {/* What a button in an email will look like, text colour chosen for legibility. */}
            <span
              className="inline-flex items-center rounded-md px-4 py-2 font-medium text-sm"
              style={{ background: shown, color: inkOn(shown) }}
            >
              {t("sample")}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">{t("colorHelp")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="brand-website">{t("website")}</Label>
          <Input
            id="brand-website"
            inputMode="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="www.example.com"
            aria-invalid={wrong(website)}
          />
          {wrong(website) && <p className="text-destructive text-xs">{t("invalidUrl")}</p>}
        </div>

        <fieldset className="space-y-3">
          <legend className="font-medium text-sm">{t("socials")}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SOCIAL_KINDS.map((kind) => (
              <div key={kind} className="space-y-1.5">
                <Label htmlFor={`brand-${kind}`}>{t(`social.${kind}`)}</Label>
                <Input
                  id={`brand-${kind}`}
                  inputMode="url"
                  value={socials[kind]}
                  onChange={(e) => setSocials((s) => ({ ...s, [kind]: e.target.value }))}
                  placeholder={SOCIAL_PLACEHOLDER[kind]}
                  aria-invalid={wrong(socials[kind])}
                />
                {wrong(socials[kind]) && <p className="text-destructive text-xs">{t("invalidUrl")}</p>}
              </div>
            ))}
          </div>
        </fieldset>

        <Button onClick={save} disabled={pending}>
          {tp("save")}
        </Button>
      </CardContent>
    </Card>
  );
}
